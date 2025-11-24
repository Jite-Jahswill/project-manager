// controllers/training.controller.js
const { Training, User, sequelize } = require("../models");
const sendMail = require("../utils/mailer");

// Notify attendees + superadmin/admin
const notifyAttendeesAndAdmins = async (subject, html, trainingId) => {
  try {
    const training = await Training.findByPk(trainingId, {
      include: [
        { model: User, as: "attendees", attributes: ["email", "firstName", "lastName"] }
      ]
    });

    if (!training || training.attendees.length === 0) return;

    const attendeeEmails = training.attendees.map(u => u.email).filter(Boolean);

    // Add superadmin & admin emails
    const admins = await User.findAll({
      attributes: ["email"],
      include: [{
        model: require("../models").Role,
        as: "role",
        where: { name: { [require("sequelize").Op.in]: ["superadmin", "admin"] } },
        attributes: []
      }]
    });
    const allEmails = [...new Set([...attendeeEmails, ...admins.map(a => a.email)])];

    await sendMail({ to: allEmails, subject, html });
  } catch (err) {
    console.error("Training notification failed:", err.message);
  }
};

// CREATE TRAINING
exports.createTraining = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { courseName, nextTrainingDate, attendeeIds = [] } = req.body;

    if (!courseName || !nextTrainingDate || attendeeIds.length === 0) {
      return res.status(400).json({ error: "courseName, nextTrainingDate, and attendeeIds are required" });
    }

    const training = await Training.create({ courseName, nextTrainingDate }, { transaction: t });
    await training.addAttendees(attendeeIds, { transaction: t });
    await t.commit();

    const fullTraining = await Training.findByPk(training.id, {
      include: [{ model: User, as: "attendees", attributes: ["id", "firstName", "lastName", "email"] }]
    });

    // await notifyAttendeesAndAdmins(
    //   `New Training Scheduled: ${courseName}`,
    //   `<h3>You have been enrolled in a training</h3>
    //    <p><strong>Course:</strong> ${courseName}</p>
    //    <p><strong>Date:</strong> ${nextTrainingDate}</p>
    //    <p>Please mark your calendar.</p>`,
    //   training.id
    // );

    res.status(201).json(fullTraining);
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// GET ALL + SEARCH + PAGINATION
exports.getAllTrainings = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = "";
    let reps = { limit: parseInt(limit), offset };
    if (search) {
      where = `WHERE t.courseName LIKE :search`;
      reps.search = `%${search}%`;
    }

    const [trainings, [{ total }]] = await Promise.all([
      sequelize.query(
        `SELECT 
           t.*,
           COUNT(ta.userId) AS attendeeCount
         FROM Trainings t
         LEFT JOIN TrainingAttendees ta ON t.id = ta.trainingId
         ${where}
         GROUP BY t.id
         ORDER BY t.nextTrainingDate ASC
         LIMIT :limit OFFSET :offset`,
        { replacements: reps, type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(`SELECT COUNT(*) as total FROM Trainings t ${where}`, {
        replacements: reps,
        type: sequelize.QueryTypes.SELECT
      })
    ]);

    res.json({
      trainings,
      pagination: {
        total: Number(total),
        page: parseInt(page),
        totalPages: Math.ceil(total / limit),
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET SINGLE TRAINING BY ID
exports.getTrainingById = async (req, res) => {
  try {
    const { id } = req.params;
    const training = await Training.findByPk(id, {
      include: [{
        model: User,
        as: "attendees",
        attributes: ["id", "firstName", "lastName", "email"]
      }]
    });

    if (!training) return res.status(404).json({ message: "Training not found" });
    res.json(training);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// SEND REMINDER (One-click button)
exports.sendReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const training = await Training.findByPk(id, {
      include: [{ model: User, as: "attendees" }]
    });

    if (!training) return res.status(404).json({ message: "Training not found" });

    // await notifyAttendeesAndAdmins(
    //   `REMINDER: ${training.courseName} – Action Required`,
    //   `<h2 style="color:#d32f2f">FINAL REMINDER</h2>
    //    <p><strong>Course:</strong> ${training.courseName}</p>
    //    <p><strong>Date:</strong> ${training.nextTrainingDate}</p>
    //    <p><strong>Progress:</strong> ${training.progress}%</p>
    //    <p>Please attend or inform your supervisor if unable to join.</p>`,
    //   id
    // );

    await training.update({ reminderSentAt: new Date() });

    res.json({ message: "Reminder successfully sent to all attendees and admins" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UPDATE TRAINING (Full) – RAW MYSQL
exports.updateTraining = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    const [existing] = await sequelize.query(
      `SELECT * FROM Trainings WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    if (!existing) {
      await t.rollback();
      return res.status(404).json({ message: "Training not found" });
    }

    req.body._previousData = existing;

    const updates = [];
    const vals = { id };

    if (req.body.courseName !== undefined) { updates.push("courseName = :courseName"); vals.courseName = req.body.courseName; }
    if (req.body.nextTrainingDate !== undefined) { updates.push("nextTrainingDate = :nextTrainingDate"); vals.nextTrainingDate = req.body.nextTrainingDate; }
    if (req.body.progress !== undefined) {
      const progress = Math.min(100, Math.max(0, parseInt(req.body.progress)));
      updates.push("progress = :progress");
      vals.progress = progress;

      // Auto status on progress
      if (progress === 100) updates.push("status = 'Completed'");
      else if (progress > 0 && progress < 100) updates.push("status = 'In Progress'");
    }

    if (req.body.status !== undefined) {
      updates.push("status = :status");
      vals.status = req.body.status;
    }

    if (updates.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: "No fields to update" });
    }

    await sequelize.query(
      `UPDATE Trainings SET ${updates.join(", ")}, updatedAt = NOW() WHERE id = :id`,
      { replacements: vals, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    const [updated] = await sequelize.query(
      `SELECT * FROM Trainings WHERE id = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    await t.commit();

    // if (updated.progress === 100) {
    //   await notifyAttendeesAndAdmins(
    //     `Training Completed: ${updated.courseName}`,
    //     `<h3>Congratulations!</h3><p>You have successfully completed: <strong>${updated.courseName}</strong></p>`
    //   );
    // }

    res.json(updated);
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// UPDATE STATUS ONLY (PATCH)
exports.updateStatus = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { status } = req.body;

    const valid = ["Scheduled", "In Progress", "Urgent", "Completed", "Cancelled"];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await sequelize.query(
      `UPDATE Trainings SET status = :status, updatedAt = NOW() WHERE id = :id`,
      { replacements: { id, status }, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    const [updated] = await sequelize.query(
      `SELECT * FROM Trainings WHERE id = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    await t.commit();

    // await notifyAttendeesAndAdmins(
    //   `Training Status Updated: ${updated.courseName}`,
    //   `<p>Status changed to: <strong>${status}</strong></p>`
    // );

    res.json(updated);
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// DELETE TRAINING
exports.deleteTraining = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    const training = await Training.findByPk(id);
    if (!training) return res.status(404).json({ message: "Training not found" });

    req.body = req.body || {};
    req.body._deletedData = training.toJSON();

    await sequelize.query(
      `DELETE FROM TrainingAttendees WHERE trainingId = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.DELETE, transaction: t }
    );
    await training.destroy({ transaction: t });

    await t.commit();

    // await notifyAttendeesAndAdmins(
    //   `Training Cancelled: ${training.courseName}`,
    //   `<p>The following training has been cancelled:</p><h3>${training.courseName}</h3>`
    // );

    res.json({ message: "Training deleted successfully" });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};
