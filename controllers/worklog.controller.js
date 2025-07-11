const { WorkLog, Project, Task, User } = require("../models");
const { Op } = require("sequelize");

exports.logWork = async (req, res) => {
  try {
    // Restrict to admins and managers
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can log work" });
    }

    const { projectId, taskId, hoursWorked, description } = req.body;

    // Validate input
    if (!projectId || !taskId || !hoursWorked || !description) {
      return res
        .status(400)
        .json({
          message:
            "projectId, taskId, hoursWorked, and description are required",
        });
    }

    const project = await Project.findByPk(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const task = await Task.findByPk(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const newLog = await WorkLog.create({
      userId: req.user.id,
      projectId,
      taskId,
      hoursWorked,
      description,
      date: new Date(), // Add current date if not provided
    });

    res.status(201).json({ message: "Work log created", log: newLog });
  } catch (err) {
    console.error("Log work error:", err);
    res
      .status(500)
      .json({ error: "Failed to create work log", details: err.message });
  }
};

exports.getUserLogs = async (req, res) => {
  try {
    const { projectId, taskId, date } = req.query;

    const whereClause = { userId: req.user.id };

    // Add search conditions
    if (projectId) whereClause.projectId = projectId;
    if (taskId) whereClause.taskId = taskId;
    if (date) whereClause.date = { [Op.eq]: date }; // Exact date match

    const logs = await WorkLog.findAll({
      where: whereClause,
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: Task, attributes: ["id", "title"] },
      ],
    });

    res.json(logs);
  } catch (err) {
    console.error("Get user logs error:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch user logs", details: err.message });
  }
};

exports.getProjectLogs = async (req, res) => {
  try {
    // Restrict to admins and managers
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can view project logs" });
    }

    const { projectId } = req.params;
    if (!projectId)
      return res.status(400).json({ error: "projectId is required" });

    const project = await Project.findByPk(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const logs = await WorkLog.findAll({
      where: { projectId },
      include: [
        { model: User, attributes: ["id", "firstName", "lastName", "email"] },
        { model: Task, attributes: ["id", "title"] },
      ],
    });

    res.json(logs);
  } catch (err) {
    console.error("Get project logs error:", err);
    res
      .status(500)
      .json({ error: "Failed to fetch project logs", details: err.message });
  }
};

exports.searchUserLogs = async (req, res) => {
  try {
    const { projectId, taskId, date } = req.query;

    const whereClause = { userId: req.user.id };

    // Add search conditions
    if (projectId) whereClause.projectId = projectId;
    if (taskId) whereClause.taskId = taskId;
    if (date) whereClause.date = { [Op.eq]: date };

    const logs = await WorkLog.findAll({
      where: whereClause,
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: Task, attributes: ["id", "title"] },
      ],
    });

    res.json(logs);
  } catch (err) {
    console.error("Search user logs error:", err);
    res
      .status(500)
      .json({ error: "Failed to search user logs", details: err.message });
  }
};

exports.deleteLog = async (req, res) => {
  try {
    // Restrict to admins and managers
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can delete logs" });
    }

    const { logId } = req.params;
    if (!logId) return res.status(400).json({ error: "logId is required" });

    const log = await WorkLog.findByPk(logId);
    if (!log) return res.status(404).json({ error: "Log not found" });

    // Check permission
    if (
      log.userId !== req.user.id &&
      !["admin", "manager"].includes(req.user.role)
    ) {
      return res
        .status(403)
        .json({ message: "You do not have permission to delete this log" });
    }

    await log.destroy();
    res.status(200).json({ message: "Work log deleted successfully" });
  } catch (err) {
    console.error("Delete log error:", err);
    res
      .status(500)
      .json({ error: "Failed to delete work log", details: err.message });
  }
};
