// controllers/hseReport.controller.js
const { Op } = require("sequelize");
const db = require("../models");
const { HSEReport, HseDocument, User, sequelize, Role } = db;

async function notifyAdminsAndManagers(subject, html, transaction = null) {
  try {
    const recipients = await User.findAll({
      attributes: ["email"],
      include: [
        {
          model: Role,
          as: "role",
          where: { name: "superadmin" }, // Only superadmins
          attributes: [],
        },
      ],
      transaction,
    });

    if (recipients.length === 0) {
      console.log("No superadmins found to notify.");
      return;
    }

    const emails = recipients
      .map((u) => u.email)
      .filter(Boolean)
      .map((email) =>
        sendMail({
          to: email,
          subject,
          html,
        }).catch((err) =>
          console.error(`Failed to send email to ${email}:`, err.message)
        )
      );

    await Promise.all(emails);
    console.log(`Notified ${emails.length} superadmin(s)`);
  } catch (error) {
        console.error("notifyAdminsAndManagers error:", error.message);
  }
}

// CREATE REPORT + UPLOAD FILES
exports.createReport = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { title, dateOfReport, timeOfReport, report, attachedDocIds } = req.body;
    if (!req.body) req.body = {};
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
    const {
      title,
      dateOfReport,
      timeOfReport,
      report,
      status,
      closedBy,
      attachedDocIds,
      detachDocIds,
    } = req.body || {};

    // ENSURE req.body exists for audit
    if (!req.body) req.body = {};

    // 1. FETCH CURRENT REPORT (for audit)
    const [existing] = await sequelize.query(
      `SELECT * FROM HSEReports WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    if (!existing) {
      await t.rollback();
      return res.status(404).json({ message: "Report not found" });
    }

    // AUDIT: SET OLD VALUES
    req.body._previousData = existing;

    // 2. BUILD UPDATE QUERY
    const updates = [];
    const replacements = { id };

    if (title !== undefined) {
      updates.push("title = :title");
      replacements.title = title;
    }
    if (dateOfReport !== undefined) {
      updates.push("dateOfReport = :dateOfReport");
      replacements.dateOfReport = dateOfReport;
    }
    if (timeOfReport !== undefined) {
      updates.push("timeOfReport = :timeOfReport");
      replacements.timeOfReport = timeOfReport;
    }
    if (report !== undefined) {
      updates.push("report = :report");
      replacements.report = report;
    }
    if (status !== undefined) {
      updates.push("status = :status");
      replacements.status = status;
      if (status === "closed") {
        updates.push("closedAt = NOW()", "closedBy = :closedBy");
        replacements.closedBy = closedBy || req.user.id;
      }
    }

    if (updates.length > 0) {
      await sequelize.query(
        `UPDATE HSEReports 
         SET ${updates.join(", ")}, updatedAt = NOW() 
         WHERE id = :id`,
        { replacements, type: sequelize.QueryTypes.UPDATE, transaction: t }
      );
    }

    // 3. HANDLE FILE UPLOADS
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const docs = req.uploadedFiles.map((file) => ({
        name: file.originalname,
        firebaseUrls: JSON.stringify([file.firebaseUrl]),
        uploadedBy: req.user.id,
        reportId: existing.id,
        type: file.mimetype,
        size: file.size,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await sequelize.query(
        `INSERT INTO HseDocuments 
         (name, firebaseUrls, uploadedBy, reportId, type, size, createdAt, updatedAt)
         VALUES ${docs.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
        {
          replacements: docs.flatMap(d => [
            d.name,
            d.firebaseUrls,
            d.uploadedBy,
            d.reportId,
            d.type,
            d.size,
            d.createdAt,
            d.updatedAt,
          ]),
          type: sequelize.QueryTypes.INSERT,
          transaction: t,
        }
      );
    }

    // 4. ATTACH EXISTING DOCS
    if (attachedDocIds && attachedDocIds.length > 0) {
      await sequelize.query(
        `UPDATE HseDocuments SET reportId = :reportId WHERE id IN (:attachedDocIds)`,
        { replacements: { reportId: existing.id, attachedDocIds }, transaction: t }
      );
    }

    // 5. DETACH DOCS
    if (detachDocIds && detachDocIds.length > 0) {
      await sequelize.query(
        `UPDATE HseDocuments SET reportId = NULL WHERE id IN (:detachDocIds) AND reportId = :reportId`,
        { replacements: { detachDocIds, reportId: existing.id }, transaction: t }
      );
    }

    // 6. FETCH UPDATED REPORT
    const [updated] = await sequelize.query(
      `SELECT 
         r.*,
         reporter.id AS 'reporter.id',
         reporter.firstName AS 'reporter.firstName',
         reporter.lastName AS 'reporter.lastName',
         reporter.email AS 'reporter.email',
         closer.id AS 'closer.id',
         closer.firstName AS 'closer.firstName',
         closer.lastName AS 'closer.lastName',
         closer.email AS 'closer.email'
       FROM HSEReports r
       LEFT JOIN Users reporter ON r.reporterId = reporter.id
       LEFT JOIN Users closer ON r.closedBy = closer.id
       WHERE r.id = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    // 7. NOTIFY
    const html = `
      <h3>Report Updated</h3>
      <p><strong>Title:</strong> ${updated.title}</p>
      <p><strong>Status:</strong> ${updated.status}</p>
      <p><strong>Updated by:</strong> ${req.user.firstName} ${req.user.lastName}</p>
    `;
    await notifyAdminsAndManagers("HSE Report Updated", html, t);

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
    if (!req.body) req.body = {};
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
