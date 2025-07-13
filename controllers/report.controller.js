const db = require("../models");
const sendMail = require("../utils/mailer");
const Report = db.Report;
const User = db.User;
const Project = db.Project;

// Helper: Notify admins and managers
async function notifyAdminsAndManagers(subject, html) {
  try {
    const recipients = await User.findAll({
      where: {
        role: ["admin", "manager"],
      },
    });

    const emailPromises = recipients.map((user) =>
      sendMail({
        to: user.email,
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

exports.createReport = async (req, res) => {
  try {
    const { projectId, title, content } = req.body;

    if (!projectId || !title || !content) {
      return res
        .status(400)
        .json({ message: "projectId, title, and content are required" });
    }

    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const report = await Report.create({
      userId: req.user.id,
      projectId,
      title,
      content,
    });

    // Fetch report details for email
    const author = await User.findByPk(req.user.id, {
      attributes: ["firstName", "lastName", "email"],
    });

    const html = `
      <h3>New Report Created</h3>
      <p><strong>Title:</strong> ${title}</p>
      <p><strong>Content:</strong> ${content}</p>
      <p><strong>Project:</strong> ${project.name}</p>
      <p><strong>By:</strong> ${author.firstName} ${author.lastName} (${author.email})</p>
    `;

    await notifyAdminsAndManagers("New Report Submitted", html);

    res.status(201).json({ message: "Report created successfully", report });
  } catch (error) {
    console.error("Create report error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      role: req.user?.role,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Failed to create report", details: error.message });
  }
};

exports.getAllReports = async (req, res) => {
  try {
    const { projectId, userName, projectName, page = 1, limit = 20 } = req.query;
    const whereClause = {};

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
          attributes: ["id", "firstName", "lastName"],
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
    res
      .status(500)
      .json({ message: "Error fetching reports", details: error.message });
  }
};

exports.getReportById = async (req, res) => {
  try {
    const { id } = req.params;

    const report = await Report.findByPk(id, {
      include: [
        { model: User, attributes: ["id", "firstName", "lastName"] },
        { model: Project, attributes: ["id", "name"] },
      ],
    });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Restrict staff to their own reports
    if (req.user.role === "staff" && report.userId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Unauthorized to view this report" });
    }

    res.status(200).json(report);
  } catch (error) {
    console.error("Get report error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      role: req.user?.role,
      reportId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Error retrieving report", details: error.message });
  }
};

exports.deleteReport = async (req, res) => {
  try {
    const { id } = req.params;

    const report = await Report.findByPk(id);

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Only creator, manager, or admin can delete
    if (req.user.role === "staff" && report.userId !== req.user.id) {
      return res.status(403).json({ message: "Forbidden" });
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
    res
      .status(500)
      .json({ message: "Failed to delete report", details: error.message });
  }
};

exports.updateReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    const report = await Report.findByPk(id);

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Only creator, manager, or admin can update
    if (req.user.role === "staff" && report.userId !== req.user.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await db.sequelize.query(
      "UPDATE Reports SET title = :title, content = :content WHERE id = :id",
      {
        replacements: {
          title: title || report.title,
          content: content || report.content,
          id,
        },
        type: db.sequelize.QueryTypes.UPDATE,
      }
    );

    // Fetch updated report
    const updatedReport = await Report.findByPk(id);

    // Send update notification
    const project = await Project.findByPk(report.projectId);
    const author = await User.findByPk(report.userId, {
      attributes: ["firstName", "lastName", "email"],
    });

    const html = `
      <h3>Report Updated</h3>
      <p><strong>Title:</strong> ${updatedReport.title}</p>
      <p><strong>Content:</strong> ${updatedReport.content}</p>
      <p><strong>Project:</strong> ${project?.name}</p>
      <p><strong>By:</strong> ${author.firstName} ${author.lastName} (${author.email})</p>
    `;

    await notifyAdminsAndManagers("Report Updated", html);

    res
      .status(200)
      .json({ message: "Report updated successfully", report: updatedReport });
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
    res
      .status(500)
      .json({ message: "Failed to update report", details: error.message });
  }
};
