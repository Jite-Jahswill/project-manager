// controllers/risk.controller.js
const { Risk, User, sequelize } = require("../models");
const sendMail = require("../utils/mailer");

// Helper: Notify superadmins + admins
const notifyAdmins = async (subject, html) => {
  try {
    const admins = await User.findAll({
      attributes: ["email", "firstName", "lastName"],
      include: [{
        model: require("../models").Role,
        as: "role",
        where: { name: { [require("sequelize").Op.in]: ["superadmin", "admin"] } },
        attributes: []
      }]
    });

    if (admins.length === 0) return;

    const emails = admins.map(u => u.email).filter(Boolean);
    await sendMail({
      to: emails,
      subject,
      html
    });
  } catch (err) {
    console.error("Failed to notify admins:", err.message);
  }
};

// CREATE RISK
exports.createRisk = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { hazard, severity, likelihood, mitigation, status = "Identified", ownerId, reviewDate } = req.body;

    if (!hazard || !severity || !likelihood || !reviewDate) {
      return res.status(400).json({ error: "hazard, severity, likelihood, and reviewDate are required" });
    }

    const risk = await Risk.create({
      hazard,
      severity,
      likelihood,
      mitigation,
      status,
      ownerId: ownerId || req.user.id,
      reviewDate
    }, { transaction: t });

    await t.commit();

    const fullRisk = await Risk.findByPk(risk.id, {
      include: [{ model: User, as: "owner", attributes: ["id", "firstName", "lastName", "email"] }]
    });

    // Notify
    // await notifyAdmins("New Risk Added", `
    //   <h3>New Risk Registered</h3>
    //   <p><strong>Hazard:</strong> ${hazard}</p>
    //   <p><strong>Severity:</strong> ${severity} | <strong>Likelihood:</strong> ${likelihood}</p>
    //   <p><strong>Owner:</strong> ${fullRisk.owner.fullName}</p>
    //   <p><strong>Review Date:</strong> ${reviewDate}</p>
    //   <p>Added by: ${req.user.firstName} ${req.user.lastName}</p>
    // `);

    res.status(201).json(fullRisk);
  } catch (err) {
    await t.rollback();
    console.error("createRisk error:", err);
    res.status(500).json({ error: err.message });
  }
};

// GET ALL + SEARCH + PAGINATION
exports.getAllRisks = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let whereClause = "";
    let replacements = {};

    if (search) {
      whereClause = `WHERE r.hazard LIKE :search OR u.firstName LIKE :search OR u.lastName LIKE :search`;
      replacements.search = `%${search}%`;
    }

    const query = `
      SELECT 
        r.*, 
        u.id AS "owner.id", u.firstName AS "owner.firstName", u.lastName AS "owner.lastName", u.email AS "owner.email"
      FROM Risks r
      LEFT JOIN Users u ON r.ownerId = u.id
      ${whereClause}
      ORDER BY r.reviewDate ASC
      LIMIT :limit OFFSET :offset
    `;

    const countQuery = `SELECT COUNT(*) as total FROM Risks r ${whereClause}`;

    const [risks, [{ total }]] = await Promise.all([
      sequelize.query(query, {
        replacements: { ...replacements, limit: limitNum, offset },
        type: sequelize.QueryTypes.SELECT
      }),
      sequelize.query(countQuery, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      })
    ]);

    res.json({
      risks,
      pagination: {
        total: Number(total),
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
        itemsPerPage: limitNum
      }
    });
  } catch (err) {
    console.error("getAllRisks error:", err);
    res.status(500).json({ error: err.message });
  }
};

// UPDATE RISK – USING RAW MYSQL (as requested)
exports.updateRisk = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    // Get previous data for audit
    const [previous] = await sequelize.query(
      `SELECT * FROM Risks WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    if (!previous) {
      await t.rollback();
      return res.status(404).json({ message: "Risk not found" });
    }

    req.body._previousData = previous;

    const updates = [];
    const replacements = { id };

    if (req.body.hazard !== undefined) { updates.push("hazard = :hazard"); replacements.hazard = req.body.hazard; }
    if (req.body.severity !== undefined) { updates.push("severity = :severity"); replacements.severity = req.body.severity; }
    if (req.body.likelihood !== undefined) { updates.push("likelihood = :likelihood"); replacements.likelihood = req.body.likelihood; }
    if (req.body.mitigation !== undefined) { updates.push("mitigation = :mitigation"); replacements.mitigation = req.body.mitigation; }
    if (req.body.status !== undefined) { updates.push("status = :status"); replacements.status = req.body.status; }
    if (req.body.ownerId !== undefined) { updates.push("ownerId = :ownerId"); replacements.ownerId = req.body.ownerId; }
    if (req.body.reviewDate !== undefined) { updates.push("reviewDate = :reviewDate"); replacements.reviewDate = req.body.reviewDate; }

    if (updates.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: "No fields to update" });
    }

    await sequelize.query(
      `UPDATE Risks SET ${updates.join(", ")}, updatedAt = NOW() WHERE id = :id`,
      { replacements, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    const [updated] = await sequelize.query(
      `SELECT r.*, u.id AS "owner.id", u.firstName AS "owner.firstName", u.lastName AS "owner.lastName", u.email AS "owner.email"
       FROM Risks r LEFT JOIN Users u ON r.ownerId = u.id WHERE r.id = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    await t.commit();

    // Notify
    // await notifyAdmins("Risk Updated", `
    //   <h3>Risk Updated</h3>
    //   <p><strong>Hazard:</strong> ${updated.hazard}</p>
    //   <p><strong>Status:</strong> ${updated.status}</p>
    //   <p><strong>Updated by:</strong> ${req.user.firstName} ${req.user.lastName}</p>
    // `);

    res.json(updated);
  } catch (err) {
    await t.rollback();
    console.error("updateRisk error:", err);
    res.status(500).json({ error: err.message });
  }
};

// DELETE RISK
exports.deleteRisk = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    const risk = await Risk.findByPk(id);
    if (!risk) return res.status(404).json({ message: "Risk not found" });

    req.body._deletedData = risk.toJSON();
    await risk.destroy({ transaction: t });
    await t.commit();

    // await notifyAdmins("Risk Deleted", `
    //   <h3>Risk Removed from Register</h3>
    //   <p><strong>Hazard:</strong> ${risk.hazard}</p>
    //   <p><strong>Deleted by:</strong> ${req.user.firstName} ${req.user.lastName}</p>
    // `);

    res.json({ message: "Risk deleted successfully" });
  } catch (err) {
    await t.rollback();
    console.error("deleteRisk error:", err);
    res.status(500).json({ error: err.message });
  }
};
