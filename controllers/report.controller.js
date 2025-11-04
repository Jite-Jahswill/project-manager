const db = require("../models");
const sendMail = require("../utils/mailer");

const Report = db.Report;
const User = db.User;
const Project = db.Project;
const Team = db.Team;

// Helper: Notify admins and managers
async function notifyAdminsAndManagers(subject, html, transaction = null) {
  try {
    const recipients = await User.findAll({
      where: { role: ["superadmin", "admin"] },
      attributes: ["email"],
      transaction,
    });
    const emailPromises = recipients
      .map((u) => u.email)
      .filter(Boolean)
      .map((email) =>
        sendMail({
          to: email,
          subject,
          html,
        })
      );
    await Promise.all(emailPromises);
  } catch (error) {
    console.error(`notifyAdminsAndManagers error: ${error.message}`);
  }
}

module.exports = {
  // CREATE
  async createReport(req, res) {
    const t = await db.sequelize.transaction();
    try {
      const {
        dateOfReport,
        timeOfReport,
        report,
        supportingDocUrl,
        projectId,
        teamId,
      } = req.body;

      if (!dateOfReport || !timeOfReport || !report) {
        await t.rollback();
        return res.status(400).json({ message: "dateOfReport, timeOfReport, and report are required" });
      }

      const reporter = await User.findByPk(req.user.id, { transaction: t });
      if (!reporter) {
        await t.rollback();
        return res.status(404).json({ message: "Reporter not found" });
      }

      const project = projectId
        ? await Project.findByPk(projectId, { transaction: t })
        : null;
      if (projectId && !project) {
        await t.rollback();
        return res.status(404).json({ message: "Project not found" });
      }

      const team = teamId ? await Team.findByPk(teamId, { transaction: t }) : null;
      if (teamId && !team) {
        await t.rollback();
        return res.status(404).json({ message: "Team not found" });
      }

      const newReport = await Report.create(
        {
          dateOfReport,
          timeOfReport,
          reporterId: req.user.id,
          report,
          supportingDocUrl: supportingDocUrl || null,
          projectId: project?.id || null,
          teamId: team?.id || null,
        },
        { transaction: t }
      );

      const response = await Report.findByPk(newReport.id, {
        include: [
          { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, as: "project", attributes: ["id", "name"] },
          { model: Team, as: "team", attributes: ["id", "name"] },
        ],
        transaction: t,
      });

      await t.commit();
      res.status(201).json({ message: "Report created", report: response });
    } catch (err) {
      await t.rollback();
      console.error("createReport error:", err);
      res.status(500).json({ message: "Error creating report", details: err.message });
    }
  },

  // READ ALL
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
        {
          model: User,
          as: "reporter",
          attributes: ["id", "firstName", "lastName", "email"],
          where: reporterName
            ? {
                [db.Sequelize.Op.or]: [
                  { firstName: { [db.Sequelize.Op.like]: `%${reporterName}%` } },
                  { lastName: { [db.Sequelize.Op.like]: `%${reporterName}%` } },
                ],
              }
            : undefined,
        },
        { model: Project, as: "project", attributes: ["id", "name"] },
        { model: Team, as: "team", attributes: ["id", "name"] },
      ];

      const { count, rows } = await Report.findAndCountAll({
        where,
        include,
        order: [["createdAt", "DESC"]],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
      });

      res.status(200).json({
        reports: rows,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(count / limitNum),
          totalItems: count,
          itemsPerPage: limitNum,
        },
      });
    } catch (err) {
      console.error("getAllReports error:", err);
      res.status(500).json({ message: "Error fetching reports", details: err.message });
    }
  },

  // READ ONE
  async getReportById(req, res) {
    try {
      const report = await Report.findByPk(req.params.id, {
        include: [
          { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
          { model: User, as: "closer", attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, as: "project", attributes: ["id", "name"] },
          { model: Team, as: "team", attributes: ["id", "name"] },
        ],
      });
      if (!report) return res.status(404).json({ message: "Report not found" });
      res.json({ report });
    } catch (err) {
      console.error("getReportById error:", err);
      res.status(500).json({ message: "Error retrieving report", details: err.message });
    }
  },

  // UPDATE
  async updateReport(req, res) {
    const t = await db.sequelize.transaction();
    try {
      const { id } = req.params;
      const {
        dateOfReport,
        timeOfReport,
        report,
        supportingDocUrl,
        status,
        closedBy,
      } = req.body;

      const reportInst = await Report.findByPk(id, { transaction: t });
      if (!reportInst) {
        await t.rollback();
        return res.status(404).json({ message: "Report not found" });
      }

      const updates = {};
      if (dateOfReport) updates.dateOfReport = dateOfReport;
      if (timeOfReport) updates.timeOfReport = timeOfReport;
      if (report) updates.report = report;
      if (supportingDocUrl !== undefined) updates.supportingDocUrl = supportingDocUrl;
      if (status) {
        updates.status = status;
        if (status === "closed") {
          updates.closedAt = new Date();
          updates.closedBy = closedBy || req.user.id;
        }
      }

      await reportInst.update(updates, { transaction: t });

      const updated = await Report.findByPk(id, {
        include: [
          { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
          { model: User, as: "closer", attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, as: "project", attributes: ["id", "name"] },
          { model: Team, as: "team", attributes: ["id", "name"] },
        ],
        transaction: t,
      });

      const html = `
        <h3>Report Updated</h3>
        <p><strong>Date:</strong> ${updated.dateOfReport} ${updated.timeOfReport}</p>
        <p><strong>Status:</strong> ${updated.status}</p>
        <p><strong>Reporter:</strong> ${updated.reporter.firstName} ${updated.reporter.lastName}</p>
        <p><strong>Updated by:</strong> ${req.user.firstName} ${req.user.lastName}</p>
      `;
      await notifyAdminsAndManagers("Report Updated", html, t);

      await t.commit();
      res.json({ message: "Report updated", report: updated });
    } catch (err) {
      await t.rollback();
      console.error("updateReport error:", err);
      res.status(500).json({ message: "Error updating report", details: err.message });
    }
  },

  // DELETE
  async deleteReport(req, res) {
    const t = await db.sequelize.transaction();
    try {
      const report = await Report.findByPk(req.params.id, {
        include: [
          { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        ],
        transaction: t,
      });
      if (!report) {
        await t.rollback();
        return res.status(404).json({ message: "Report not found" });
      }

      const html = `
        <h3>Report Deleted</h3>
        <p><strong>Date:</strong> ${report.dateOfReport} ${report.timeOfReport}</p>
        <p><strong>Reporter:</strong> ${report.reporter.firstName} ${report.reporter.lastName}</p>
        <p>Deleted by: ${req.user.firstName} ${req.user.lastName}</p>
      `;

      await notifyAdminsAndManagers("Report Deleted", html, t);
      await report.destroy({ transaction: t });
      await t.commit();
      res.json({ message: "Report deleted successfully" });
    } catch (err) {
      await t.rollback();
      console.error("deleteReport error:", err);
      res.status(500).json({ message: "Error deleting report", details: err.message });
    }
  },

  // CLOSE REPORT (extra endpoint – optional)
  async closeReport(req, res) {
    const t = await db.sequelize.transaction();
    try {
      const report = await Report.findByPk(req.params.id, { transaction: t });
      if (!report) {
        await t.rollback();
        return res.status(404).json({ message: "Report not found" });
      }
      if (report.status === "closed") {
        await t.rollback();
        return res.status(400).json({ message: "Report already closed" });
      }

      await report.update(
        { status: "closed", closedAt: new Date(), closedBy: req.user.id },
        { transaction: t }
      );

      const updated = await Report.findByPk(req.params.id, {
        include: [
          { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
          { model: User, as: "closer", attributes: ["id", "firstName", "lastName", "email"] },
        ],
        transaction: t,
      });

      const html = `
        <h3>Report Closed</h3>
        <p><strong>Date:</strong> ${updated.dateOfReport} ${updated.timeOfReport}</p>
        <p><strong>Closed by:</strong> ${updated.closer.firstName} ${updated.closer.lastName}</p>
      `;
      await notifyAdminsAndManagers("Report Closed", html, t);

      await t.commit();
      res.json({ message: "Report closed", report: updated });
    } catch (err) {
      await t.rollback();
      console.error("closeReport error:", err);
      res.status(500).json({ message: "Error closing report", details: err.message });
    }
  },
};
