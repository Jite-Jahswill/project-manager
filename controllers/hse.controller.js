// controllers/hse.controller.js
const { HSEReport, User, sequelize } = require("../models");
const { Op } = require("sequelize");

// === CREATE ===
exports.createHSEReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { dateOfReport, timeOfReport, report } = req.body;
    const reporterId = req.user.id;
    const file = req.uploadedFiles?.[0];

    if (!dateOfReport || !timeOfReport || !report) {
      return res.status(400).json({ message: "dateOfReport, timeOfReport, and report are required" });
    }

    const hseReport = await HSEReport.create(
      {
        dateOfReport,
        timeOfReport,
        reporterId,
        report,
        supportingDocUrl: file?.firebaseUrl || null,
        status: "open",
      },
      { transaction: t }
    );

    await t.commit();

    const full = await HSEReport.findByPk(hseReport.id, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName"] },
      ],
    });

    res.status(201).json({ message: "HSE report submitted", hseReport: full });
  } catch (err) {
    await t.rollback();
    console.error("HSE create error:", err);
    res.status(500).json({ message: "Failed to submit", details: err.message });
  }
};

// === READ ALL (Admin + Filter by Status) ===
exports.getAllHSEReports = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", status } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (search) {
      where[Op.or] = [
        { report: { [Op.like]: `%${search}%` } },
        { "$reporter.firstName$": { [Op.like]: `%${search}%` } },
        { "$reporter.lastName$": { [Op.like]: `%${search}%` } },
      ];
    }
    if (status && ["open", "pending", "closed"].includes(status)) {
      where.status = status;
    }

    const { count, rows } = await HSEReport.findAndCountAll({
      where,
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName"], required: false },
      ],
      order: [["dateOfReport", "DESC"], ["timeOfReport", "DESC"]],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      hseReports: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Get HSE error:", err);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
};

// === READ ONE ===
exports.getHSEReport = async (req, res) => {
  try {
    const { id } = req.params;
    const report = await HSEReport.findByPk(id, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName"], required: false },
      ],
    });

    if (!report) return res.status(404).json({ message: "Report not found" });

    res.json({ hseReport: report });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch report" });
  }
};

// === UPDATE (Admin Only) ===
exports.updateHSEReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { report, supportingDocUrl, status } = req.body;
    const file = req.uploadedFiles?.[0];

    const hseReport = await HSEReport.findByPk(id, { transaction: t });
    if (!hseReport) {
      await t.rollback();
      return res.status(404).json({ message: "Report not found" });
    }

    const updates = {};
    if (report) updates.report = report;
    if (supportingDocUrl) updates.supportingDocUrl = supportingDocUrl;
    if (file?.firebaseUrl) updates.supportingDocUrl = file.firebaseUrl;
    if (status && ["open", "pending", "closed"].includes(status)) {
      updates.status = status;
      if (status === "closed") {
        updates.closedAt = new Date();
        updates.closedBy = req.user.id;
      }
    }

    await hseReport.update(updates, { transaction: t });
    await t.commit();

    const updated = await HSEReport.findByPk(id, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName"], required: false },
      ],
    });

    res.json({ message: "Report updated", hseReport: updated });
  } catch (err) {
    await t.rollback();
    console.error("Update HSE error:", err);
    res.status(500).json({ error: "Failed to update" });
  }
};

// === DELETE (Soft or Hard – Admin) ===
exports.deleteHSEReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const report = await HSEReport.findByPk(id, { transaction: t });
    if (!report) {
      await t.rollback();
      return res.status(404).json({ message: "Report not found" });
    }

    await report.destroy({ transaction: t });
    await t.commit();

    res.json({ message: "Report deleted permanently" });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: "Failed to delete" });
  }
};
