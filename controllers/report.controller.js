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
      .map((user) => user.email)
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
    console.error(`Error in notifyAdminsAndManagers: ${error.message}`, {
      stack: error.stack,
      context: { endpoint: "notifyAdminsAndManagers", subject },
    });
  }
}

module.exports = {
  // Create a new report (open to any authenticated user)
  async createReport(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      // Check if required models are defined
      if (!User || typeof User.findOne !== "function") {
        throw new Error("User model is undefined or invalid");
      }
      if (!Report || typeof Report.create !== "function") {
        throw new Error("Report model is undefined or invalid");
      }

      const { title, content, teamId, projectId } = req.body;

      // Validate input
      if (!title) {
        await transaction.rollback();
        return res.status(400).json({ message: "Title is required" });
      }
      if (!content) {
        await transaction.rollback();
        return res.status(400).json({ message: "Content is required" });
      }
      if (!projectId) {
        await transaction.rollback();
        return res.status(400).json({ message: "Project ID is required" });
      }

      // Verify user exists
      const user = await User.findOne({
        where: { id: req.user.id },
        attributes: ["id", "firstName", "lastName", "email"],
        transaction,
      });
      if (!user) {
        await transaction.rollback();
        return res.status(404).json({ message: "User not found" });
      }

      // Verify team exists (if provided)
      let team = null;
      if (teamId) {
        if (!Team || typeof Team.findOne !== "function") {
          throw new Error("Team model is undefined or invalid");
        }
        team = await Team.findOne({
          where: { id: teamId },
          attributes: ["id", "name"],
          transaction,
        });
        if (!team) {
          await transaction.rollback();
          return res.status(404).json({ message: "Team not found" });
        }
      }

      // Verify project exists
      if (!Project || typeof Project.findOne !== "function") {
        throw new Error("Project model is undefined or invalid");
      }
      const project = await Project.findOne({
        where: { id: projectId },
        attributes: ["id", "name"],
        transaction,
      });
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ message: "Project not found" });
      }

      // Create report using Sequelize
      const report = await Report.create(
        {
          title,
          content,
          userId: req.user.id,
          teamId: teamId || null,
          projectId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction }
      );

      // Format response
      const reportResponse = {
        id: report.id,
        title: report.title,
        content: report.content,
        user: {
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
        },
        team: team ? { teamId: team.id, name: team.name } : null,
        project: { projectId: project.id, name: project.name },
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
      };

      await transaction.commit();
      res.status(201).json({ message: "Report created", report: reportResponse });
    } catch (err) {
      await transaction.rollback();
      console.error(`Error in createReport: ${err.message}`, {
        stack: err.stack,
        userId: req.user?.id || null,
        context: { endpoint: "createReport", body: req.body },
      });
      res.status(500).json({ message: "Error creating report", details: err.message });
    }
  },

  // Get all reports (all authenticated users see all reports with filters)
  async getAllReports(req, res) {
    try {
      const { projectId, userName, projectName, page = 1, limit = 20 } = req.query;
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: "Invalid page or limit" });
      }

      const whereClause = {};
      if (projectId) {
        whereClause.projectId = projectId;
      }

      const offset = (pageNum - 1) * limitNum;
      const { count, rows } = await Report.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: User,
            attributes: ["id", "firstName", "lastName", "email"],
            where: userName
              ? {
                  [db.Sequelize.Op.or]: [
                    { firstName: { [db.Sequelize.Op.like]: `%${userName}%` } },
                    { lastName: { [db.Sequelize.Op.like]: `%${userName}%` } },
                  ],
                }
              : undefined,
          },
          {
            model: Project,
            attributes: ["id", "name"],
            where: projectName
              ? {
                  name: { [db.Sequelize.Op.like]: `%${projectName}%` },
                }
              : undefined,
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: limitNum,
        offset,
      });

      const totalPages = Math.ceil(count / limitNum);

      res.status(200).json({
        reports: rows,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalItems: count,
          itemsPerPage: limitNum,
        },
      });
    } catch (error) {
      console.error(`Error in getAllReports: ${error.message}`, {
        stack: error.stack,
        userId: req.user?.id || null,
        context: { endpoint: "getAllReports", userId: req.user?.id, role: req.user?.role, query: req.query },
      });
      res.status(500).json({ message: "Error fetching reports", details: error.message });
    }
  },

  // Get a single report by ID (all authenticated users can view any report)
  async getReportById(req, res) {
    try {
      const { id } = req.params;

      const report = await Report.findByPk(id, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, attributes: ["id", "name"] },
        ],
      });

      if (!report) {
        return res.status(404).json({ message: "Report not found" });
      }

      res.status(200).json({ report });
    } catch (error) {
      console.error(`Error in getReportById: ${error.message}`, {
        stack: error.stack,
        userId: req.user?.id || null,
        context: { endpoint: "getReportById", userId: req.user?.id, role: req.user?.role, reportId: req.params.id },
      });
      res.status(500).json({ message: "Error retrieving report", details: error.message });
    }
  },

  // Update a report (all authenticated users can update any report)
  async updateReport(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      const { id } = req.params;
      const { title, content } = req.body;

      // Validate input
      if (!title && !content) {
        await transaction.rollback();
        return res.status(400).json({ message: "At least one field (title, content) is required" });
      }

      const report = await Report.findByPk(id, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, attributes: ["id", "name"] },
        ],
        transaction,
      });

      if (!report) {
        await transaction.rollback();
        return res.status(404).json({ message: "Report not found" });
      }

      // Build raw SQL query
      const updates = [];
      const replacements = [];
      if (title) {
        updates.push("title = ?");
        replacements.push(title);
      }
      if (content) {
        updates.push("content = ?");
        replacements.push(content);
      }
      updates.push("updatedAt = NOW()");

      if (updates.length > 1 || (updates.length === 1 && !updates.includes("updatedAt = NOW()"))) {
        await db.sequelize.query(
          `
          UPDATE Reports
          SET ${updates.join(", ")}
          WHERE id = ?
          `,
          {
            replacements: [...replacements, parseInt(id)],
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          }
        );
      }

      // Fetch updated report
      const updatedReport = await Report.findByPk(id, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, attributes: ["id", "name"] },
        ],
        transaction,
      });

      // Send update notification
      const html = `
        <h3>Report Updated</h3>
        <p><strong>Title:</strong> ${updatedReport.title}</p>
        <p><strong>Content:</strong> ${updatedReport.content}</p>
        <p><strong>Project:</strong> ${updatedReport.Project?.name || "N/A"}</p>
        <p><strong>By:</strong> ${updatedReport.User.firstName} ${updatedReport.User.lastName} (${updatedReport.User.email})</p>
      `;

      await notifyAdminsAndManagers("Report Updated", html, transaction);

      await transaction.commit();
      res.status(200).json({
        message: "Report updated successfully",
        report: updatedReport,
      });
    } catch (error) {
      await transaction.rollback();
      console.error(`Error in updateReport: ${error.message}`, {
        stack: error.stack,
        userId: req.user?.id || null,
        context: { endpoint: "updateReport", userId: req.user?.id, role: req.user?.role, reportId: req.params.id, body: req.body },
      });
      res.status(500).json({ message: "Error updating report", details: error.message });
    }
  },

  // Delete a report (all authenticated users can delete any report)
  async deleteReport(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      const { id } = req.params;

      const report = await Report.findByPk(id, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, attributes: ["id", "name"] },
        ],
        transaction,
      });

      if (!report) {
        await transaction.rollback();
        return res.status(404).json({ message: "Report not found" });
      }

      // Send deletion notification
      const html = `
        <h3>Report Deleted</h3>
        <p><strong>Title:</strong> ${report.title}</p>
        <p><strong>Project:</strong> ${report.Project?.name || "N/A"}</p>
        <p><strong>By:</strong> ${report.User.firstName} ${report.User.lastName} (${report.User.email})</p>
        <p>Deleted by: ${req.user.firstName} ${req.user.lastName} (${req.user.email})</p>
      `;

      // Notify admins/managers and the report's creator (if different from deleter)
      const recipients = [{ email: report.User.email, role: "staff" }].filter(
        (recipient) => recipient.email !== req.user.email // Avoid notifying the deleter
      );
      const adminManagerEmails = await User.findAll({
        where: { role: ["admin", "manager"] },
        attributes: ["email"],
        transaction,
      }).then((users) => users.map((u) => u.email).filter(Boolean));

      const allRecipients = [...recipients.map((r) => r.email), ...adminManagerEmails];
      if (allRecipients.length > 0) {
        await sendMail({
          to: allRecipients,
          subject: "Report Deleted",
          html,
        });
      }

      await report.destroy({ transaction });

      await transaction.commit();
      res.status(200).json({ message: "Report deleted successfully" });
    } catch (error) {
      await transaction.rollback();
      console.error(`Error in deleteReport: ${error.message}`, {
        stack: error.stack,
        userId: req.user?.id || null,
        context: { endpoint: "deleteReport", userId: req.user?.id, role: req.user?.role, reportId: req.params.id },
      });
      res.status(500).json({ message: "Error deleting report", details: error.message });
    }
  },

  // Assign a report to a user (open to any authenticated user)
  async assignReportToUser(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      const { reportId, userId } = req.body;

      // Validate input
      if (!reportId || !userId) {
        await transaction.rollback();
        return res.status(400).json({ message: "reportId and userId are required" });
      }

      // Check if report exists
      const report = await Report.findByPk(reportId, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, attributes: ["id", "name"] },
        ],
        transaction,
      });
      if (!report) {
        await transaction.rollback();
        return res.status(404).json({ message: "Report not found" });
      }

      // Check if user exists
      const user = await User.findByPk(userId, {
        attributes: ["id", "firstName", "lastName", "email"],
        transaction,
      });
      if (!user) {
        await transaction.rollback();
        return res.status(404).json({ message: "User not found" });
      }

      // Update report's userId using raw SQL
      await db.sequelize.query(
        `
        UPDATE Reports
        SET userId = ?, updatedAt = NOW()
        WHERE id = ?
        `,
        {
          replacements: [parseInt(userId), parseInt(reportId)],
          type: db.sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      // Fetch updated report
      const updatedReport = await Report.findByPk(reportId, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, attributes: ["id", "name"] },
        ],
        transaction,
      });

      // Notify admins, managers, and the assigned user
      const html = `
        <h3>Report Assigned</h3>
        <p><strong>Title:</strong> ${updatedReport.title}</p>
        <p><strong>Project:</strong> ${updatedReport.Project?.name || "N/A"}</p>
        <p><strong>Assigned to:</strong> ${updatedReport.User.firstName} ${updatedReport.User.lastName} (${updatedReport.User.email})</p>
        <p><strong>Assigned by:</strong> ${req.user.firstName} ${req.user.lastName} (${req.user.email})</p>
      `;

      const adminManagerEmails = await User.findAll({
        where: { role: ["admin", "manager"] },
        attributes: ["email"],
        transaction,
      }).then((users) => users.map((u) => u.email).filter(Boolean));

      const allRecipients = [user.email, ...adminManagerEmails].filter(Boolean);
      if (allRecipients.length > 0) {
        await sendMail({
          to: allRecipients,
          subject: "Report Assigned to User",
          html,
        });
      }

      await transaction.commit();
      res.status(200).json({
        message: "Report assigned successfully",
        report: updatedReport,
      });
    } catch (error) {
      await transaction.rollback();
      console.error(`Error in assignReportToUser: ${error.message}`, {
        stack: error.stack,
        userId: req.user?.id || null,
        context: { endpoint: "assignReportToUser", userId: req.user?.id, reportId: req.body.reportId, assignedUserId: req.body.userId },
      });
      res.status(500).json({ message: "Error assigning report", details: error.message });
    }
  },
};
