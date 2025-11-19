// controllers/auditor.controller.js
const { Auditor, sequelize } = require("../models");
const sendMail = require("../utils/mailer");

const notifyAdmins = async (subject, html) => {
  try {
    const admins = await require("../models").User.findAll({
      attributes: ["email"],
      include: [{
        model: require("../models").Role,
        as: "role",
        where: { name: { [require("sequelize").Op.in]: ["superadmin", "admin"] } },
        attributes: []
      }]
    });
    if (admins.length === 0) return;
    await sendMail({
      to: admins.map(a => a.email),
      subject,
      html
    });
  } catch (err) {
    console.error("Notify admins failed:", err);
  }
};

// CREATE AUDIT
exports.createAudit = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { title, date, area, inspectors = [] } = req.body;

    if (!title || !date || !area) {
      return res.status(400).json({ error: "title, date, and area are required" });
    }

    // Accept single string or array
    const inspectorList = Array.isArray(inspectors) ? inspectors : [inspectors].filter(Boolean);

    const audit = await Auditor.create({
      title,
      date,
      area,
      inspectors: inspectorList,
    }, { transaction: t });

    await t.commit();

    // await notifyAdmins("New Audit Scheduled", `
    //   <h3>New Audit Created</h3>
    //   <p><strong>Title:</strong> ${title}</p>
    //   <p><strong>Date:</strong> ${date}</p>
    //   <p><strong>Area:</strong> ${area}</p>
    //   <p><strong>Inspector(s):</strong> ${inspectorList.join(", ") || "None assigned"}</p>
    //   <p>Created by: ${req.user.firstName} ${req.user.lastName}</p>
    // `);

    res.status(201).json(audit);
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// GET ALL + SEARCH + PAGINATION
exports.getAllAudits = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = "";
    let replacements = { limit: parseInt(limit), offset };

    if (search) {
      where = `WHERE title LIKE :search OR area LIKE :search OR inspectors LIKE :search`;
      replacements.search = `%${search}%`;
    }

    const [audits, [{ total }]] = await Promise.all([
      sequelize.query(
        `SELECT * FROM Audits ${where} ORDER BY date ASC LIMIT :limit OFFSET :offset`,
        { replacements, type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(*) as total FROM Audits ${where}`,
        { replacements, type: sequelize.QueryTypes.SELECT }
      )
    ]);

    res.json({
      audits,
      pagination: {
        total: Number(total),
        page: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UPDATE – RAW MYSQL ONLY
exports.updateAudit = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    const [previous] = await sequelize.query(
      `SELECT * FROM Audits WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    if (!previous) {
      await t.rollback();
      return res.status(404).json({ message: "Audit not found" });
    }

    req.body._previousData = previous;

    const updates = [];
    const replacements = { id };

    if (req.body.title !== undefined) { updates.push("title = :title"); replacements.title = req.body.title; }
    if (req.body.date !== undefined) { updates.push("date = :date"); replacements.date = req.body.date; }
    if (req.body.area !== undefined) { updates.push("area = :area"); replacements.area = req.body.area; }
    if (req.body.inspectors !== undefined) {
      const list = Array.isArray(req.body.inspectors) ? req.body.inspectors : [req.body.inspectors].filter(Boolean);
      updates.push("inspectors = :inspectors");
      replacements.inspectors = JSON.stringify(list);
    }

    if (updates.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: "No fields provided" });
    }

    await sequelize.query(
      `UPDATE Audits SET ${updates.join(", ")}, updatedAt = NOW() WHERE id = :id`,
      { replacements, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    const [updated] = await sequelize.query(
      `SELECT * FROM Audits WHERE id = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    await t.commit();

    // await notifyAdmins("Audit Schedule Updated", `
    //   <h3>Audit Updated</h3>
    //   <p><strong>Title:</strong> ${updated.title}</p>
    //   <p><strong>New Date:</strong> ${updated.date}</p>
    //   <p><strong>Updated by:</strong> ${req.user.firstName} ${req.user.lastName}</p>
    // `);

    res.json(updated);
  } catch (err) {
    await t.rollback();
    console.error("updateAudit error:", err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE
exports.deleteAudit = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const audit = await Auditor.findByPk(id);
    if (!audit) return res.status(404).json({ message: "Audit not found" });

    req.body._deletedData = audit.toJSON();
    await audit.destroy({ transaction: t });
    await t.commit();

    // await notifyAdmins("Audit Deleted", `
    //   <h3>Audit Removed</h3>
    //   <p><strong>Title:</strong> ${audit.title}</p>
    //   <p><strong>Date:</strong> ${audit.date}</p>
    //   <p>Deleted by: ${req.user.firstName} ${req.user.lastName}</p>
    // `);

    res.json({ message: "Audit deleted" });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};
