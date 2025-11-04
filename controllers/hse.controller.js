const { HSEReport, HseDocument, User, sequelize } = require("../models");
const { Op } = require("sequelize");

//
// === CREATE ===
//
exports.createHSEReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { dateOfReport, timeOfReport, report, hseDocumentId } = req.body;
    const reporterId = req.user.id;

    if (!dateOfReport || !timeOfReport || !report) {
      return res.status(400).json({
        message: "dateOfReport, timeOfReport, and report are required",
      });
    }

    let supportingDocUrl = null;

    // 1️⃣ If user attached new file(s)
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      // Create document record(s)
      const createdDocs = await Promise.all(
        req.uploadedFiles.map((file) =>
          HseDocument.create(
            {
              name: file.originalname,
              firebaseUrls: [file.firebaseUrl],
              uploadedBy: reporterId,
              type: file.mimetype,
              size: file.size,
            },
            { transaction: t }
          )
        )
      );

      // Set supportingDocUrl from first uploaded file
      supportingDocUrl = createdDocs[0].firebaseUrls[0];
    }

    // 2️⃣ If user referenced an existing document instead
    else if (hseDocumentId) {
      const existingDoc = await HseDocument.findByPk(hseDocumentId, {
        transaction: t,
      });
      if (!existingDoc)
        return res.status(404).json({ message: "Referenced document not found" });

      supportingDocUrl = existingDoc.firebaseUrls?.[0] || null;
    }

    // 3️⃣ Create HSE report
    const hseReport = await HSEReport.create(
      {
        dateOfReport,
        timeOfReport,
        reporterId,
        report,
        supportingDocUrl,
        status: "open",
      },
      { transaction: t }
    );

    // Link uploaded docs to this report
    if (req.uploadedFiles?.length > 0) {
      await HseDocument.update(
        { reportId: hseReport.id },
        {
          where: {
            uploadedBy: reporterId,
            id: {
              [Op.in]: req.uploadedFiles.map((f) => f.dbId).filter(Boolean),
            },
          },
          transaction: t,
        }
      );
    }

    await t.commit();

    const full = await HSEReport.findByPk(hseReport.id, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        { model: HseDocument, as: "documents" },
      ],
    });

    res.status(201).json({ message: "HSE report submitted", hseReport: full });
  } catch (err) {
    await t.rollback();
    console.error("HSE create error:", err);
    res.status(500).json({ message: "Failed to submit", details: err.message });
  }
};


//
// === READ ALL (Search + Date Filter) ===
//
exports.getAllHSEReports = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", status, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;
    const where = {};

    // 🔍 Search by report content or reporter name
    if (search) {
      where[Op.or] = [
        { report: { [Op.like]: `%${search}%` } },
        { "$reporter.firstName$": { [Op.like]: `%${search}%` } },
        { "$reporter.lastName$": { [Op.like]: `%${search}%` } },
      ];
    }

    // 🔖 Filter by status
    if (status && ["open", "pending", "closed"].includes(status)) {
      where.status = status;
    }

    // 📅 Filter by date range
    if (startDate || endDate) {
      where.dateOfReport = {};
      if (startDate) where.dateOfReport[Op.gte] = new Date(startDate);
      if (endDate) where.dateOfReport[Op.lte] = new Date(endDate);
    }

    const { count, rows } = await HSEReport.findAndCountAll({
      where,
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName"], required: false },
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
    console.error("Get HSE error:", err);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
};


//
// === UPDATE ===
//
exports.updateHSEReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { report, status, hseDocumentId } = req.body;
    const hseReport = await HSEReport.findByPk(id, { transaction: t });

    if (!hseReport) {
      await t.rollback();
      return res.status(404).json({ message: "Report not found" });
    }

    const updates = {};

    if (report) updates.report = report;
    if (status && ["open", "pending", "closed"].includes(status)) {
      updates.status = status;
      if (status === "closed") {
        updates.closedAt = new Date();
        updates.closedBy = req.user.id;
      }
    }

    // If new file(s) uploaded
    if (req.uploadedFiles?.length > 0) {
      const newDocs = await Promise.all(
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
      updates.supportingDocUrl = newDocs[0].firebaseUrls[0];
    }

    // Or reuse an existing document
    else if (hseDocumentId) {
      const doc = await HseDocument.findByPk(hseDocumentId, { transaction: t });
      if (doc) updates.supportingDocUrl = doc.firebaseUrls?.[0];
    }

    await hseReport.update(updates, { transaction: t });
    await t.commit();

    const updated = await HSEReport.findByPk(id, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName"], required: false },
        { model: HseDocument, as: "documents" },
      ],
    });

    res.json({ message: "Report updated successfully", hseReport: updated });
  } catch (err) {
    await t.rollback();
    console.error("Update HSE error:", err);
    res.status(500).json({ error: "Failed to update" });
  }
};


//
// === DELETE REPORT & DOCUMENTS ===
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
    res.json({ message: "Report and attached documents deleted" });
  } catch (err) {
    await t.rollback();
    console.error("Delete HSE error:", err);
    res.status(500).json({ error: "Failed to delete" });
  }
};


//
// === DOCUMENT CRUD ===
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
    res.status(500).json({ error: "Failed to get documents" });
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
