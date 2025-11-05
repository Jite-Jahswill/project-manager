const { Op } = require("sequelize");
const { HSEReport, HseDocument, User } = require("../models");

// 🟢 Create new HSE report
exports.createReport = async (req, res) => {
  try {
    const { dateOfReport, timeOfReport, report, firebaseUrls, attachedDocs } = req.body;
    const reporterId = req.user.id;

    if (!dateOfReport || !timeOfReport || !report)
      return res.status(400).json({ error: "Missing required fields" });

    // ✅ Create report
    const newReport = await HSEReport.create({
      dateOfReport,
      timeOfReport,
      report,
      reporterId,
      firebaseUrls: firebaseUrls || [],
      attachedDocs: attachedDocs || [],
    });

    // ✅ If attached existing docs by ID, link them
    if (attachedDocs && attachedDocs.length > 0) {
      await HseDocument.update(
        { reportId: newReport.id },
        { where: { id: attachedDocs } }
      );
    }

    // ✅ If firebaseUrls exist but not attached docs, create new docs
    if (firebaseUrls && firebaseUrls.length > 0) {
      const docsToCreate = firebaseUrls.map((url) => ({
        name: "Uploaded File",
        firebaseUrls: [url],
        uploadedBy: reporterId,
        reportId: newReport.id,
        type: "unknown",
        size: 0,
      }));
      await HseDocument.bulkCreate(docsToCreate);
    }

    return res.status(201).json({
      message: "Report created successfully",
      report: newReport,
    });
  } catch (err) {
    console.error("createReport error:", err);
    return res.status(500).json({ error: "Failed to create report" });
  }
};

// 🟡 Update existing HSE report
exports.updateReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { dateOfReport, timeOfReport, report, firebaseUrls, attachedDocs, status, closedBy } = req.body;
    const userId = req.user.id;

    const existing = await HSEReport.findByPk(id);
    if (!existing)
      return res.status(404).json({ message: "Report not found" });

    // ✅ Update report base fields
    await existing.update({
      dateOfReport: dateOfReport ?? existing.dateOfReport,
      timeOfReport: timeOfReport ?? existing.timeOfReport,
      report: report ?? existing.report,
      firebaseUrls: firebaseUrls ?? existing.firebaseUrls,
      attachedDocs: attachedDocs ?? existing.attachedDocs,
      status: status ?? existing.status,
      closedBy: closedBy ?? existing.closedBy,
      closedAt: status === "closed" ? new Date() : existing.closedAt,
    });

    // ✅ Re-link attachedDocs if provided
    if (attachedDocs && attachedDocs.length > 0) {
      await HseDocument.update(
        { reportId: existing.id },
        { where: { id: attachedDocs } }
      );
    }

    // ✅ If firebaseUrls newly added, create new docs for them
    if (firebaseUrls && firebaseUrls.length > 0) {
      const docsToCreate = firebaseUrls.map((url) => ({
        name: "Updated File",
        firebaseUrls: [url],
        uploadedBy: userId,
        reportId: existing.id,
        type: "unknown",
        size: 0,
      }));
      await HseDocument.bulkCreate(docsToCreate);
    }

    return res.status(200).json({
      message: "Report updated successfully",
      report: existing,
    });
  } catch (err) {
    console.error("updateReport error:", err);
    return res.status(500).json({ error: "Failed to update report" });
  }
};

// 🔴 Delete HSE report (and unlink related docs)
exports.deleteReport = async (req, res) => {
  try {
    const { id } = req.params;

    const report = await HSEReport.findByPk(id);
    if (!report)
      return res.status(404).json({ message: "Report not found" });

    // ✅ Unlink documents from this report (keep documents for history)
    await HseDocument.update({ reportId: null }, { where: { reportId: id } });

    await report.destroy();

    return res.status(200).json({ message: "Report deleted successfully" });
  } catch (err) {
    console.error("deleteReport error:", err);
    return res.status(500).json({ error: "Failed to delete report" });
  }
};

// 🔵 Get HSEReport by Document ID
exports.getReportByDocumentId = async (req, res) => {
  try {
    const { documentId } = req.params;

    const document = await HseDocument.findByPk(documentId);
    if (!document)
      return res.status(404).json({ message: "Document not found" });

    const report = await HSEReport.findByPk(document.reportId, {
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName", "email"] },
        { model: HseDocument, as: "documents" },
      ],
    });

    if (!report)
      return res.status(404).json({ message: "No report linked to this document" });

    return res.status(200).json(report);
  } catch (err) {
    console.error("getReportByDocumentId error:", err);
    return res.status(500).json({ error: "Failed to fetch report by document ID" });
  }
};

// 🔵 Get Documents by Report ID
exports.getDocumentsByReportId = async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await HSEReport.findByPk(reportId);
    if (!report)
      return res.status(404).json({ message: "Report not found" });

    const documents = await HseDocument.findAll({ where: { reportId } });

    return res.status(200).json({ reportId, documents });
  } catch (err) {
    console.error("getDocumentsByReportId error:", err);
    return res.status(500).json({ error: "Failed to fetch documents by report ID" });
  }
};
