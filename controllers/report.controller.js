const db = require("../models");
const sendMail = require("../utils/mailer");
const Report = db.Report;
const User = db.User;
const Project = db.Project;
const ProjectUser = db.ProjectUser; // Junction table for project assignments
const Team = db.Team;

// Helper: Notify admins and managers
async function notifyAdminsAndManagers(subject, html) {
  try {
    const recipients = await User.findAll({
      where: {
        role: ["admin", "manager"],
      },
      attributes: ["email"],
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
    console.error("Notify admins and managers error:", {
      message: error.message,
      stack: error.stack,
      subject,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = {
  // Create a new report (open to any authenticated user)
async createReport(req, res) {
  const transaction = await db.sequelize.transaction();
  try {
    const { title, description, teamId, projectId } = req.body;

    // Validate input
    if (!title) {
      await transaction.rollback();
      return res.status(400).json({ message: "Title is required" });
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

    // Verify project exists (if provided)
    let project = null;
    if (projectId) {
      if (!Project || typeof Project.findOne !== "function") {
        throw new Error("Project model is undefined or invalid");
      }
      project = await Project.findOne({
        where: { id: projectId },
        attributes: ["id", "name"],
        transaction,
      });
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ message: "Project not found" });
      }
    }

    // Create report using Sequelize
    const report = await Report.create(
      {
        title,
        description: description || null,
        userId: req.user.id,
        teamId: teamId || null,
        projectId: projectId || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { transaction }
    );

    // Format response
    const reportResponse = {
      id: report.id,
      title: report.title,
      description: report.description,
      user: {
        userId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      team: team ? { teamId: team.id, name: team.name } : null,
      project: project ? { projectId: project.id, name: project.name } : null,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };

    await transaction.commit();
    res.status(201).json({ message: "Report created", report: reportResponse });
  } catch (err) {
    await transaction.rollback();
    // No error logging to the Error model
    res.status(500).json({ message: "Error creating report", details: err.message });
  }
},
  // Get all reports (Staff see own, Admins/Managers see all with filters)
  async getAllReports(req, res) {
    try {
      const { projectId, userName, projectName, page = 1, limit = 20 } = req.query;
      const whereClause = {};

      // Role-based visibility
      if (req.user.role === "staff") {
        whereClause.userId = req.user.id;
      } else if (projectId) {
        whereClause.projectId = projectId;
      }

      const offset = (parseInt(page) - 1) * parseInt(limit);
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
        limit: parseInt(limit),
        offset,
      });

      const totalPages = Math.ceil(count / limit);

      res.status(200).json({
        reports: rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Get all reports error:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        role: req.user?.role,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error fetching reports", details: error.message });
    }
  },

  // Get a single report by ID (Staff see own, Admins/Managers see all)
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

      // Restrict staff to their own reports
      if (req.user.role === "staff" && report.userId !== req.user.id) {
        return res.status(403).json({ message: "Unauthorized to view this report" });
      }

      res.status(200).json({ report });
    } catch (error) {
      console.error("Get report error:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        role: req.user?.role,
        reportId: req.params.id,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error retrieving report", details: error.message });
    }
  },

  // Update a report (Staff can update own, Admins/Managers can update any)
  async updateReport(req, res) {
    try {
      const { id } = req.params;
      const { title, content } = req.body;

      // Validate input
      if (!title && !content) {
        return res.status(400).json({ message: "At least one field (title, content) is required" });
      }

      const report = await Report.findByPk(id, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, attributes: ["id", "name"] },
        ],
      });

      if (!report) {
        return res.status(404).json({ message: "Report not found" });
      }

      // Restrict staff to their own reports
      if (req.user.role === "staff" && report.userId !== req.user.id) {
        return res.status(403).json({ message: "Unauthorized to update this report" });
      }

      // Build raw SQL query
      const updates = [];
      if (title) updates.push(`title = '${title.replace(/'/g, "\\'")}'`);
      if (content) updates.push(`content = '${content.replace(/'/g, "\\'")}'`);
      updates.push(`updatedAt = NOW()`);

      if (updates.length > 1 || (updates.length === 1 && !updates.includes(`updatedAt = NOW()`))) {
        const query = `
          UPDATE Reports
          SET ${updates.join(", ")}
          WHERE id = ${parseInt(id)}
        `;
        await db.sequelize.query(query, { type: db.sequelize.QueryTypes.UPDATE });
      }

      // Fetch updated report
      const updatedReport = await Report.findByPk(id, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, attributes: ["id", "name"] },
        ],
      });

      // Send update notification
      const html = `
        <h3>Report Updated</h3>
        <p><strong>Title:</strong> ${updatedReport.title}</p>
        <p><strong>Content:</strong> ${updatedReport.content}</p>
        <p><strong>Project:</strong> ${updatedReport.Project?.name}</p>
        <p><strong>By:</strong> ${updatedReport.User.firstName} ${updatedReport.User.lastName} (${updatedReport.User.email})</p>
      `;

      await notifyAdminsAndManagers("Report Updated", html);

      res.status(200).json({
        message: "Report updated successfully",
        report: updatedReport,
      });
    } catch (error) {
      console.error("Update report error:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        role: req.user?.role,
        reportId: req.params.id,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error updating report", details: error.message });
    }
  },

  // Delete a report (Staff can delete own, Admins/Managers can delete any)
  async deleteReport(req, res) {
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

      // Restrict staff to their own reports
      if (req.user.role === "staff" && report.userId !== req.user.id) {
        return res.status(403).json({ message: "Unauthorized to delete this report" });
      }

      // Send deletion notification
      const html = `
        <h3>Report Deleted</h3>
        <p><strong>Title:</strong> ${report.title}</p>
        <p><strong>Project:</strong> ${report.Project?.name}</p>
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
      }).then((users) => users.map((u) => u.email).filter(Boolean));

      const allRecipients = [...recipients.map((r) => r.email), ...adminManagerEmails];
      if (allRecipients.length > 0) {
        await sendMail({
          to: allRecipients,
          subject: "Report Deleted",
          html,
        });
      }

      await report.destroy();

      res.status(200).json({ message: "Report deleted successfully" });
    } catch (error) {
      console.error("Delete report error:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        role: req.user?.role,
        reportId: req.params.id,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error deleting report", details: error.message });
    }
  },

  // Assign a report to a user (Admins and Managers only)
  async assignReportToUser(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only admins or managers can assign reports" });
      }

      const { reportId, userId } = req.body;

      // Validate input
      if (!reportId || !userId) {
        return res.status(400).json({ message: "reportId and userId are required" });
      }

      // Check if report exists
      const report = await Report.findByPk(reportId, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, attributes: ["id", "name"] },
        ],
      });
      if (!report) {
        return res.status(404).json({ message: "Report not found" });
      }

      // Check if user exists
      const user = await User.findByPk(userId, {
        attributes: ["id", "firstName", "lastName", "email"],
      });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if user is assigned to the report's project
      const assignment = await ProjectUser.findOne({
        where: { projectId: report.projectId, userId },
      });
      if (!assignment) {
        return res.status(400).json({ message: "User is not assigned to the report's project" });
      }

      // Update report's userId using raw SQL
      const query = `
        UPDATE Reports
        SET userId = ${parseInt(userId)}, updatedAt = NOW()
        WHERE id = ${parseInt(reportId)}
      `;
      await db.sequelize.query(query, { type: db.sequelize.QueryTypes.UPDATE });

      // Fetch updated report
      const updatedReport = await Report.findByPk(reportId, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
          { model: Project, attributes: ["id", "name"] },
        ],
      });

      // Notify admins, managers, and the assigned user
      const html = `
        <h3>Report Assigned</h3>
        <p><strong>Title:</strong> ${updatedReport.title}</p>
        <p><strong>Project:</strong> ${updatedReport.Project?.name}</p>
        <p><strong>Assigned to:</strong> ${updatedReport.User.firstName} ${updatedReport.User.lastName} (${updatedReport.User.email})</p>
        <p><strong>Assigned by:</strong> ${req.user.firstName} ${req.user.lastName} (${req.user.email})</p>
      `;

      const adminManagerEmails = await User.findAll({
        where: { role: ["admin", "manager"] },
        attributes: ["email"],
      }).then((users) => users.map((u) => u.email).filter(Boolean));

      const allRecipients = [user.email, ...adminManagerEmails].filter(Boolean);
      if (allRecipients.length > 0) {
        await sendMail({
          to: allRecipients,
          subject: "Report Assigned to User",
          html,
        });
      }

      res.status(200).json({
        message: "Report assigned successfully",
        report: updatedReport,
      });
    } catch (error) {
      console.error("Assign report to user error:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        role: req.user?.role,
        reportId: req.body.reportId,
        assignedUserId: req.body.userId,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error assigning report", details: error.message });
    }
  },
};
