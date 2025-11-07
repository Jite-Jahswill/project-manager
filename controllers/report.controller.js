// controllers/report.controller.js
const db = require("../models");
const sendMail = require("../utils/mailer");
const { Report, Document, User, Project, Team, sequelize, Role } = db;

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

module.exports = {
  // CREATE REPORT + UPLOAD FILES
  async createReport(req, res) {
    const t = await sequelize.transaction();
    try {
      const { title, dateOfReport, timeOfReport, report, projectId, teamId } = req.body;
      const reporterId = req.user.id;

      if (!title || !dateOfReport || !timeOfReport || !report) {
        await t.rollback();
        return res.status(400).json({ error: "title, dateOfReport, timeOfReport, and report are required" });
      }

      const project = projectId ? await Project.findByPk(projectId, { transaction: t }) : null;
      if (projectId && !project) {
        await t.rollback();
        return res.status(404).json({ error: "Project not found" });
      }

      const team = teamId ? await Team.findByPk(teamId, { transaction: t }) : null;
      if (teamId && !team) {
        await t.rollback();
        return res.status(404).json({ error: "Team not found" });
      }

      const newReport = await Report.create(
        {
          title,
          dateOfReport,
          timeOfReport,
          reporterId,
          report,
          projectId: project?.id || null,
          teamId: team?.id || null,
        },
        { transaction: t }
      );

      // Handle uploaded files
      if (req.uploadedFiles && req.uploadedFiles.length > 0) {
        const docs = req.uploadedFiles.map((file) => ({
          name: file.originalname,
          firebaseUrl: file.firebaseUrl,
          projectId: newReport.projectId,
          reportId: newReport.id,
          type: file.mimetype,
          size: file.size,
          uploadedBy: reporterId,
        }));
        await Document.bulkCreate(docs, { transaction: t });
      }

      const fullReport = await Report.findByPk(newReport.id, {
        include: [
          { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
          { model: User, as: "closer", attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, as: "project", attributes: ["id", "name"] },
          { model: Team, as: "team", attributes: ["id", "name"] },
          { model: Document, as: "documents" },
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
  },

  // UPDATE REPORT
async updateReport(req, res) {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;
      const { title, dateOfReport, timeOfReport, report, status, closedBy } = req.body;
      // ENSURE req.body exists
      if (!req.body) req.body = {};

      // 1. FETCH CURRENT DATA (for audit)
      const [existing] = await sequelize.query(
        `SELECT * FROM Reports WHERE id = :id FOR UPDATE`,
        { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
      );

      if (!existing) {
        await t.rollback();
        return res.status(404).json({ message: "Report not found" });
      }

      // AUDIT: SET OLD VALUES
      req.body._previousData = existing;

      // 2. BUILD UPDATE FIELDS
      const updates = [];
      const replacements = { id };

      if (title !== undefined) { updates.push("title = :title"); replacements.title = title; }
      if (dateOfReport !== undefined) { updates.push("dateOfReport = :dateOfReport"); replacements.dateOfReport = dateOfReport; }
      if (timeOfReport !== undefined) { updates.push("timeOfReport = :timeOfReport"); replacements.timeOfReport = timeOfReport; }
      if (report !== undefined) { updates.push("report = :report"); replacements.report = report; }
      if (status !== undefined) {
        updates.push("status = :status");
        replacements.status = status;
        if (status === "closed") {
          updates.push("closedAt = NOW()", "closedBy = :closedBy");
          replacements.closedBy = closedBy || req.user.id;
        }
      }

      if (updates.length === 0 && (!req.uploadedFiles || req.uploadedFiles.length === 0)) {
        await t.rollback();
        return res.status(400).json({ message: "No fields to update" });
      }

      // 3. UPDATE REPORT
      if (updates.length > 0) {
        await sequelize.query(
          `UPDATE Reports SET ${updates.join(", ")}, updatedAt = NOW() WHERE id = :id`,
          { replacements, type: sequelize.QueryTypes.UPDATE, transaction: t }
        );
      }

      // 4. UPLOAD NEW DOCUMENTS
      if (req.uploadedFiles && req.uploadedFiles.length > 0) {
        const docs = req.uploadedFiles.map(file => ({
          name: file.originalname,
          firebaseUrl: file.firebaseUrl,
          projectId: existing.projectId,
          reportId: existing.id,
          type: file.mimetype,
          size: file.size,
          uploadedBy: req.user.id,
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
        await Document.bulkCreate(docs, { transaction: t });
      }

      // 5. FETCH UPDATED REPORT
      const [updated] = await sequelize.query(
        `SELECT r.*, 
                reporter.firstName AS 'reporter.firstName', reporter.lastName AS 'reporter.lastName',
                closer.firstName AS 'closer.firstName', closer.lastName AS 'closer.lastName',
                p.name AS 'project.name',
                t.name AS 'team.name'
         FROM Reports r
         LEFT JOIN Users reporter ON r.reporterId = reporter.id
         LEFT JOIN Users closer ON r.closedBy = closer.id
         LEFT JOIN Projects p ON r.projectId = p.id
         LEFT JOIN Teams t ON r.teamId = t.id
         WHERE r.id = :id`,
        { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
      );

      // 6. NOTIFY
      const html = `
        <h3>Report Updated</h3>
        <p><strong>Title:</strong> ${updated.title}</p>
        <p><strong>Status:</strong> ${updated.status}</p>
        <p><strong>Updated by:</strong> ${req.user.firstName} ${req.user.lastName}</p>
      `;
      await notifyAdminsAndManagers("Project Report Updated", html, t);

      await t.commit();
      return res.status(200).json({ message: "Report updated", report: updated });
    } catch (err) {
      await t.rollback();
      console.error("updateReport error:", err);
      return res.status(500).json({ error: "Failed to update report" });
    }
  },

  // DELETE REPORT
  async deleteReport(req, res) {
    const t = await sequelize.transaction();
    try {
      if (!req.body) req.body = {};
      const report = await Report.findByPk(req.params.id, { transaction: t });
      if (!report) {
        await t.rollback();
        return res.status(404).json({ message: "Report not found" });
      }

      req.body._deletedData = report.toJSON();

      await Document.update(
        { reportId: null },
        { where: { reportId: report.id }, transaction: t }
      );

      await report.destroy({ transaction: t });
      await t.commit();

      return res.status(200).json({ message: "Report deleted" });
    } catch (err) {
      await t.rollback();
      console.error("deleteReport error:", err);
      return res.status(500).json({ error: "Failed to delete report" });
    }
  },

  // Get all report
  async getAllReports(req, res) {
    try {
      const { projectId, status, reporterName, page = 1, limit = 20 } = req.query;
  
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
  
      if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: "Invalid page or limit" });
      }
  
      const where = {};
      if (projectId) where.projectId = projectId;
      if (status) where.status = status;
  
      const include = [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName"] },
        { model: Project, as: "project" },
        { model: Team, as: "team" },
        { model: Document, as: "documents" },
      ];
  
      if (reporterName) {
        include[0].where = {
          [db.Sequelize.Op.or]: [
            { firstName: { [db.Sequelize.Op.like]: `%${reporterName}%` } },
            { lastName: { [db.Sequelize.Op.like]: `%${reporterName}%` } },
          ],
        };
      }
  
      const { count, rows } = await Report.findAndCountAll({
        where,
        include,
        order: [["createdAt", "DESC"]],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
        distinct: true,     // This fixes the count
        subQuery: false,     // Required when using limit + include
      });
  
      return res.status(200).json({
        reports: rows,
        pagination: {
          totalItems: count,
          currentPage: pageNum,
          totalPages: Math.ceil(count / limitNum),
          itemsPerPage: limitNum,
        },
      });
    } catch (err) {
      console.error("getAllReports error:", err);
      return res.status(500).json({ error: "Failed to fetch reports" });
    }
  },

  // GET ONE REPORT
  async getReportById(req, res) {
    try {
      const report = await Report.findByPk(req.params.id, {
        include: [
          { model: User, as: "reporter" },
          { model: User, as: "closer" },
          { model: Project, as: "project" },
          { model: Team, as: "team" },
          { model: Document, as: "documents" },
        ],
      });
      if (!report) return res.status(404).json({ message: "Report not found" });
      return res.status(200).json({ report });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  },

  // CLOSE REPORT
async closeReport(req, res) {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    // ENSURE req.body exists
    if (!req.body) req.body = {};

    // 1. FETCH CURRENT
    const [report] = await sequelize.query(
      `SELECT * FROM Reports WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    if (!report) {
      await t.rollback();
      return res.status(404).json({ message: "Report not found" });
    }

    if (report.status === "closed") {
      await t.rollback();
      return res.status(400).json({ message: "Already closed" });
    }

    // AUDIT: SET OLD VALUES
    req.body._previousData = report;

    // 2. CLOSE REPORT
    await sequelize.query(
      `UPDATE Reports 
       SET status = 'closed', closedAt = NOW(), closedBy = :closedBy, updatedAt = NOW()
       WHERE id = :id`,
      { replacements: { id, closedBy: req.user.id }, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    // 3. FETCH UPDATED
    const [updated] = await sequelize.query(
      `SELECT r.*, 
              closer.firstName AS 'closer.firstName', closer.lastName AS 'closer.lastName'
       FROM Reports r
       LEFT JOIN Users closer ON r.closedBy = closer.id
       WHERE r.id = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    // 4. NOTIFY
    const html = `
      <h3>Report Closed</h3>
      <p><strong>Title:</strong> ${updated.title}</p>
      <p><strong>Closed by:</strong> ${updated['closer.firstName']} ${updated['closer.lastName']}</p>
    `;
    await notifyAdminsAndManagers("Project Report Closed", html, t);

    await t.commit();
    return res.status(200).json({ message: "Report closed", report: updated });
  } catch (err) {
    await t.rollback();
    console.error("closeReport error:", err);
    return res.status(500).json({ error: "Failed to close report" });
  }
},
};
