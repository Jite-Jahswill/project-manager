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
    if (!project) return res.status(404).json({ message: "Project not found" });

    const task = await Task.findByPk(taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });

    const newLog = await WorkLog.create({
      userId: req.user.id,
      projectId,
      taskId,
      hoursWorked,
      description,
      date: new Date(),
    });

    res.status(201).json({ message: "Work log created successfully", log: newLog });
  } catch (err) {
    // Log error to errors table
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ role: req.user?.role, body: req.body }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res
      .status(500)
      .json({ message: "Failed to create work log", details: err.message });
  }
};

exports.getUserLogs = async (req, res) => {
  try {
    const { projectId, taskId, date, page = 1, limit = 20 } = req.query;

    const whereClause = { userId: req.user.id };

    // Add search conditions
    if (projectId) whereClause.projectId = projectId;
    if (taskId) whereClause.taskId = taskId;
    if (date) whereClause.date = { [Op.eq]: date };

    const { count, rows } = await WorkLog.findAndCountAll({
      where: whereClause,
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: Task, attributes: ["id", "title"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    const totalPages = Math.ceil(count / limit);

    res.status(200).json({
      logs: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    // Log error to errors table
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ role: req.user?.role, query: req.query }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res
      .status(500)
      .json({ message: "Failed to fetch user logs", details: err.message });
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
    const { page = 1, limit = 20 } = req.query;

    if (!projectId)
      return res.status(400).json({ message: "projectId is required" });

    const project = await Project.findByPk(projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const { count, rows } = await WorkLog.findAndCountAll({
      where: { projectId },
      include: [
        { model: User, attributes: ["id", "firstName", "lastName", "email"] },
        { model: Task, attributes: ["id", "title"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    const totalPages = Math.ceil(count / limit);

    res.status(200).json({
      logs: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    // Log error to errors table
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ role: req.user?.role, projectId: req.params.projectId, query: req.query }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res
      .status(500)
      .json({ message: "Failed to fetch project logs", details: err.message });
  }
};

exports.searchUserLogs = async (req, res) => {
  try {
    const { projectId, taskId, date, page = 1, limit = 20 } = req.query;

    const whereClause = { userId: req.user.id };

    // Add search conditions
    if (projectId) whereClause.projectId = projectId;
    if (taskId) whereClause.taskId = taskId;
    if (date) whereClause.date = { [Op.eq]: date };

    const { count, rows } = await WorkLog.findAndCountAll({
      where: whereClause,
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: Task, attributes: ["id", "title"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    const totalPages = Math.ceil(count / limit);

    res.status(200).json({
      logs: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    // Log error to errors table
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ role: req.user?.role, query: req.query }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res
      .status(500)
      .json({ message: "Failed to search user logs", details: err.message });
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
    if (!logId) return res.status(400).json({ message: "logId is required" });

    const log = await WorkLog.findByPk(logId);
    if (!log) return res.status(404).json({ message: "Log not found" });

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
    // Log error to errors table
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ role: req.user?.role, logId: req.params.logId }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res
      .status(500)
      .json({ message: "Failed to delete work log", details: err.message });
  }
};
