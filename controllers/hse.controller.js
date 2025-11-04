const { HSEReport, HseDocument, User, sequelize } = require("../models");
const { Op } = require("sequelize");

//
// === CREATE REPORT ===
//
exports.createHSEReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { dateOfReport, timeOfReport, report } = req.body;
    const reporterId = req.user.id;

    if (!dateOfReport || !timeOfReport || !report)
      return res.status(400).json({ message: "dateOfReport, timeOfReport, and report are required" });

    // 1️⃣ Create the HSE Report first
    const hseReport = await HSEReport.create(
      {
        dateOfReport,
        timeOfReport,
        reporterId,
        report,
        status: "open",
      },
      { transaction: t }
    );

    // 2️⃣ Handle uploaded documents (if any)
    if (req.uploadedFiles?.length > 0) {
      await Promise.all(
        req.uploadedFiles.map((file) =>
          HseDocument.create(
            {
              name: file.originalname,
              firebaseUrls: [file.firebaseUrl],
              uploadedBy: reporterId,
              type: file.mimetype,
              size: file.size,
              reportId: hseReport.id, // link doc to report
            },
            { transaction: t }
          )
        )
      );
    }

    await t.commit();

    // Fetch full details
    const full = await HSEReport.findByPk(hseReport.id, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        { model: HseDocument, as: "documents" },
      ],
    });

    res.status(201).json({ message: "HSE report created successfully", hseReport: full });
  } catch (err) {
    await t.rollback();
    console.error("HSE create error:", err);
    res.status(500).json({ message: "Failed to create report", details: err.message });
  }
};


//
// === GET SINGLE REPORT ===
//
exports.getHSEReport = async (req, res) => {
  try {
    const { id } = req.params;
    const report = await HSEReport.findByPk(id, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email", "role"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName", "email", "role"], required: false },
        { model: HseDocument, as: "documents" },
      ],
    });

    if (!report) return res.status(404).json({ message: "Report not found" });

    res.json(report);
  } catch (err) {
    console.error("Get HSE report error:", err);
    res.status(500).json({ message: "Failed to fetch report" });
  }
};


//
// === GET ALL REPORTS (filter + pagination) ===
//
exports.getAllHSEReports = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", status, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;
    const where = {};

    if (search) {
      where[Op.or] = [
        { report: { [Op.like]: `%${search}%` } },
        { "$reporter.firstName$": { [Op.like]: `%${search}%` } },
        { "$reporter.lastName$": { [Op.like]: `%${search}%` } },
      ];
    }

    if (status && ["open", "pending", "closed"].includes(status)) where.status = status;

    if (startDate || endDate) {
      where.dateOfReport = {};
      if (startDate) where.dateOfReport[Op.gte] = new Date(startDate);
      if (endDate) where.dateOfReport[Op.lte] = new Date(endDate);
    }

    const { count, rows } = await HSEReport.findAndCountAll({
      where,
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        { model: HseDocument, as: "documents" },
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
    console.error("Get all HSE reports error:", err);
    res.status(500).json({ message: "Failed to fetch reports" });
  }
};


//
// === UPDATE REPORT + DOCS ===
//
exports.updateHSEReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { report, status } = req.body;

    const hseReport = await HSEReport.findByPk(id, { transaction: t });
    if (!hseReport) {
      await t.rollback();
      return res.status(404).json({ message: "Report not found" });
    }

    // Update text or status
    if (report) hseReport.report = report;
    if (status && ["open", "pending", "closed"].includes(status)) {
      hseReport.status = status;
      if (status === "closed") {
        hseReport.closedAt = new Date();
        hseReport.closedBy = req.user.id;
      }
    }

    // New files uploaded
    if (req.uploadedFiles?.length > 0) {
      await Promise.all(
        req.uploadedFiles.map((file) =>
          HseDocument.create(
            {
              name: file.originalname,
              firebaseUrls: [file.firebaseUrl],
              uploadedBy: req.user.id,
              reportId: hseReport.id,
              type: file.mimetype,
              size: file.size,
            },
            { transaction: t }
          )
        )
      );
    }

    await hseReport.save({ transaction: t });
    await t.commit();

    const updated = await HSEReport.findByPk(id, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName"] },
        { model: HseDocument, as: "documents" },
      ],
    });

    res.json({ message: "HSE report updated successfully", hseReport: updated });
  } catch (err) {
    await t.rollback();
    console.error("Update HSE report error:", err);
    res.status(500).json({ message: "Failed to update report" });
  }
};


//
// === DELETE REPORT + DOCUMENTS ===
//
exports.deleteHSEReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const report = await HSEReport.findByPk(id, {
      include: [{ model: HseDocument, as: "documents" }],
      transaction: t,
    });

    if (!report) {
      await t.rollback();
      return res.status(404).json({ message: "Report not found" });
    }

    await HseDocument.destroy({ where: { reportId: id }, transaction: t });
    await report.destroy({ transaction: t });

    await t.commit();
    res.json({ message: "Report and all attached documents deleted successfully" });
  } catch (err) {
    await t.rollback();
    console.error("Delete HSE report error:", err);
    res.status(500).json({ message: "Failed to delete report" });
  }
};


//
// === DOCUMENT MANAGEMENT ===
//
exports.getHseDocuments = async (req, res) => {
  try {
    const { reportId } = req.params;
    const docs = await HseDocument.findAll({
      where: { reportId },
      include: [{ model: User, as: "uploader", attributes: ["id", "firstName", "lastName"] }],
      order: [["createdAt", "DESC"]],
    });
    res.json({ documents: docs });
  } catch (err) {
    console.error("Get documents error:", err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
};

exports.deleteHseDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await HseDocument.findByPk(id);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    await doc.destroy();
    res.json({ message: "Document deleted successfully" });
  } catch (err) {
    console.error("Delete document error:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
};
