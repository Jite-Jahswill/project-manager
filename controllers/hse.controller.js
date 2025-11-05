// controllers/hseReport.controller.js
const { Op } = require("sequelize");
const db = require("../models");
const { HSEReport, HseDocument, User, sequelize } = db;

// CREATE REPORT + UPLOAD FILES
exports.createReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { title, dateOfReport, timeOfReport, report, attachedDocIds } = req.body;
    const reporterId = req.user.id;

    if (!title || !dateOfReport || !timeOfReport || !report) {
      return res.status(400).json({ error: "title, dateOfReport, timeOfReport, and report are required" });
    }

    // Create the report
    const newReport = await HSEReport.create(
      {
        title,
        dateOfReport,
        timeOfReport,
        reporterId,
        report,
      },
      { transaction: t }
    );

    // Handle uploaded files
    if (req.uploadedFiles?.length > 0) {
      const docsToCreate = req.uploadedFiles.map((file) => ({
        name: file.originalname,
        firebaseUrls: [file.firebaseUrl],
        uploadedBy: reporterId,
        reportId: newReport.id,
        type: file.mimetype,
        size: file.size,
      }));
      await HseDocument.bulkCreate(docsToCreate, { transaction: t });
    }

    // Attach existing docs
    if (attachedDocIds?.length > 0) {
      await HseDocument.update(
        { reportId: newReport.id },
        { where: { id: attachedDocIds }, transaction: t }
      );
    }

    const fullReport = await HSEReport.findByPk(newReport.id, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName", "email"] },
        { model: HseDocument, as: "documents" },
      ],
      transaction: t,
    });

    await t.commit();
    return res.status(201).json({ message: "Report created", report: fullReport });
  } catch (err) {
    await t.rollback();
    console.error("createReport error:", err);
    return res.status(500).json({ error: "Failed to create report" });
  }
};

// UPDATE REPORT
exports.updateReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { title, dateOfReport, timeOfReport, report, status, closedBy, attachedDocIds, detachDocIds } = req.body;

    const existing = await HSEReport.findByPk(id, { transaction: t });
    if (!existing) return res.status(404).json({ message: "Report not found" });

    req.body._previousData = existing.toJSON();

    const updates = {};
    if (title) updates.title = title;
    if (dateOfReport) updates.dateOfReport = dateOfReport;
    if (timeOfReport) updates.timeOfReport = timeOfReport;
    if (report) updates.report = report;
    if (status) {
      updates.status = status;
      if (status === "closed") {
        updates.closedAt = new Date();
        updates.closedBy = closedBy || req.user.id;
      }
    }

    await existing.update(updates, { transaction: t });

    // Handle new uploaded files
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const docsToCreate = req.uploadedFiles.map((file) => ({
        name: file.originalname,
        firebaseUrls: [file.firebaseUrl],
        uploadedBy: req.user.id,
        reportId: existing.id,
        type: file.mimetype,
        size: file.size,
      }));
      await HseDocument.bulkCreate(docsToCreate, { transaction: t });
    }

    // Attach new docs
    if (attachedDocIds && attachedDocIds.length > 0) {
      await HseDocument.update(
        { reportId: existing.id },
        { where: { id: attachedDocIds }, transaction: t }
      );
    }

    // Detach docs
    if (detachDocIds && detachDocIds.length > 0) {
      await HseDocument.update(
        { reportId: null },
        { where: { id: detachDocIds, reportId: existing.id }, transaction: t }
      );
    }

    const updated = await HSEReport.findByPk(id, {
      include: [
        { model: User, as: "reporter" },
        { model: User, as: "closer" },
        { model: HseDocument, as: "documents" },
      ],
      transaction: t,
    });

    await t.commit();
    return res.status(200).json({ message: "Report updated", report: updated });
  } catch (err) {
    await t.rollback();
    console.error("updateReport error:", err);
    return res.status(500).json({ error: "Failed to update report" });
  }
};

// DELETE REPORT
exports.deleteReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const report = await HSEReport.findByPk(id, { transaction: t });
    if (!report) return res.status(404).json({ message: "Report not found" });

    req.body._deletedData = report.toJSON();

    await HseDocument.update({ reportId: null }, { where: { reportId: id }, transaction: t });
    await report.destroy({ transaction: t });
    
    await t.commit();
    return res.status(200).json({ message: "Report deleted" });
  } catch (err) {
    await t.rollback();
    console.error("deleteReport error:", err);
    return res.status(500).json({ error: "Failed to delete report" });
  }
};

// GET REPORT BY DOCUMENT ID
exports.getReportByDocumentId = async (req, res) => {
  try {
    const { documentId } = req.params;
    const doc = await HseDocument.findByPk(documentId);
    if (!doc || !doc.reportId) return res.status(404).json({ message: "No report linked" });

    const report = await HSEReport.findByPk(doc.reportId, {
      include: [
        { model: User, as: "reporter" },
        { model: User, as: "closer" },
        { model: HseDocument, as: "documents" },
      ],
    });
    return res.status(200).json(report);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

// GET DOCUMENTS BY REPORT ID
exports.getDocumentsByReportId = async (req, res) => {
  try {
    const { reportId } = req.params;
    const docs = await HseDocument.findAll({
      where: { reportId },
      include: [{ model: User, as: "uploader" }],
    });
    return res.status(200).json({ reportId, documents: docs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

// UPDATE REPORT STATUS (open, pending, closed)
exports.updateReportStatus = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { status, closedBy } = req.body;
    const userId = req.user.id;

    // Validate status
    const validStatuses = ["open", "pending", "closed"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status. Must be 'open', 'pending', or 'closed'",
      });
    }

    const report = await HSEReport.findByPk(id, { transaction: t });
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    req.body._previousData = report.toJSON();

    const updates = { status };

    // Only set closedAt/closedBy when transitioning to "closed"
    if (status === "closed" && report.status !== "closed") {
      updates.closedAt = new Date();
      updates.closedBy = closedBy || userId;
    }

    // If reopening from closed, clear closedAt/closedBy
    if (status !== "closed" && report.status === "closed") {
      updates.closedAt = null;
      updates.closedBy = null;
    }

    await report.update(updates, { transaction: t });

    const updatedReport = await HSEReport.findByPk(id, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName", "email"] },
        { model: HseDocument, as: "documents" },
      ],
      transaction: t,
    });

    const previous = await Model.findByPk(id);
    req.body._previousData = previous.toJSON();
    
    await t.commit();
    return res.status(200).json({
      message: `Report status updated to "${status}"`,
      report: updatedReport,
    });
  } catch (err) {
    await t.rollback();
    console.error("updateReportStatus error:", err);
    return res.status(500).json({ error: "Failed to update report status" });
  }
};
