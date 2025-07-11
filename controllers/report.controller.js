// controllers/report.controller.js
const db = require("../models");
const sendMail = require("../utils/mailer");
const Report = db.Report;
const User = db.User;
const Project = db.Project;

// Helper: Notify admins and managers
async function notifyAdminsAndManagers(subject, html) {
  const recipients = await User.findAll({
    where: {
      role: ["admin", "manager"],
    },
  });

  for (const user of recipients) {
    await sendMail({
      to: user.email,
      subject,
      html,
    });
  }
}

exports.createReport = async (req, res) => {
  try {
    const { projectId, title, content } = req.body;

    const report = await Report.create({
      userId: req.user.id,
      projectId,
      title,
      content,
    });

    // Fetch report details for email
    const project = await Project.findByPk(projectId);
    const author = await User.findByPk(req.user.id);

    const html = `
      <h3>New Report Created</h3>
      <p><strong>Title:</strong> ${title}</p>
      <p><strong>Content:</strong> ${content}</p>
      <p><strong>Project:</strong> ${project?.name}</p>
      <p><strong>By:</strong> ${author.firstName} (${author.email})</p>
    `;

    await notifyAdminsAndManagers("New Report Submitted", html);

    res.status(201).json(report);
  } catch (error) {
    res.status(500).json({ message: "Failed to create report", error });
  }
};

exports.getAllReports = async (req, res) => {
  try {
    const { projectId, userName, projectName } = req.query;
    const whereClause = {};

    if (req.user.role === "staff") {
      whereClause.userId = req.user.id;
    } else if (projectId) {
      whereClause.projectId = projectId;
    }

    // Fetch reports with associated User and Project models
    const reports = await Report.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName"],
          // Filtering by user name if provided
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
          // Filtering by project name if provided
          where: projectName
            ? {
                name: { [db.Sequelize.Op.like]: `%${projectName}%` },
              }
            : undefined,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json(reports);
  } catch (error) {
    res.status(500).json({ message: "Error fetching reports", error });
  }
};

exports.getReportById = async (req, res) => {
  try {
    const report = await Report.findByPk(req.params.id, {
      include: [
        { model: User, attributes: ["id", "firstName", "lastName"] },
        { model: Project, attributes: ["id", "name"] },
      ],
    });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    res.status(200).json(report);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving report", error });
  }
};

exports.deleteReport = async (req, res) => {
  try {
    const report = await Report.findByPk(req.params.id);

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
    res.status(500).json({ message: "Failed to delete report", error });
  }
};

exports.updateReport = async (req, res) => {
  try {
    const { title, content } = req.body;
    const report = await Report.findByPk(req.params.id);

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // // Only creator, manager, or admin can update
    // if (req.user.role === "staff" && report.userId !== req.user.id) {
    //   return res.status(403).json({ message: "Forbidden" });
    // }

    report.title = title || report.title;
    report.content = content || report.content;
    await report.save();

    // Send update notification
    const project = await Project.findByPk(report.projectId);
    const author = await User.findByPk(report.userId);

    const html = `
      <h3>Report Updated</h3>
      <p><strong>Title:</strong> ${report.title}</p>
      <p><strong>Content:</strong> ${report.content}</p>
      <p><strong>Project:</strong> ${project?.name}</p>
      <p><strong>By:</strong> ${author.firstName} (${author.email})</p>
    `;

    await notifyAdminsAndManagers("Report Updated", html);

    res.status(200).json(report);
  } catch (error) {
    res.status(500).json({ message: "Failed to update report", error });
  }
};
