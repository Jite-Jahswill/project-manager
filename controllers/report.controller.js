const db = require("../models");
const sendMail = require("../utils/mailer");
const Report = db.Report;
const User = db.User;
const Project = db.Project;
const ProjectUser = db.ProjectUser; // Junction table for project assignments

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
  // Create a new report (Staff, Admin, Manager)
  async createReport(req, res) {
    try {
      const { projectId, title, content } = req.body;

      // Validate input
      if (!projectId || !title || !content) {
        return res.status(400).json({ message: "projectId, title, and content are required" });
      }

      // Check if project exists
      const project = await Project.findByPk(projectId, {
        attributes: ["id", "name"],
      });
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check if user is assigned to the project (for staff)
      if (req.user.role === "staff") {
        const assignment = await ProjectUser.findOne({
          where: { projectId, userId: req.user.id },
        });
        if (!assignment) {
          return res.status(403).json({ message: "User not assigned to this project" });
        }
      }

      // Fetch user data
      const author = await User.findByPk(req.user.id, {
        attributes: ["id", "firstName", "lastName", "email"],
      });
      if (!author) {
        return res.status(404).json({ message: "User not found" });
      }

      // Create report
      const report = await Report.create({
        userId: req.user.id,
        projectId,
        title,
        content,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Prepare email notification
      const html = `
        <h3>New Report Created</h3>
        <p><strong>Title:</strong> ${title}</p>
        <p><strong>Content:</strong> ${content}</p>
        <p><strong>Project:</strong> ${project.name}</p>
        <p><strong>By:</strong> ${author.firstName} ${author.lastName} (${author.email})</p>
      `;

      await notifyAdminsAndManagers("New Report Submitted", html);

      res.status(201).json({
        message: "Report created successfully",
        report: {
          id: report.id,
          userId: report.userId,
          projectId: report.projectId,
          title: report.title,
          content: report.content,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
          User: author,
          Project: project,
        },
      });
    } catch (error) {
      console.error("Create report error:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        role: req.user?.role,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error creating report", details: error.message });
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

      // Update report
      const updates = {};
      if (title) updates.title = title;
      if (content) updates.content = content;
      updates.updatedAt = new Date();

      await Report.update(updates, { where: { id } });

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
};
