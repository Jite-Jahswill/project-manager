const { WorkLog, Project, Task, User, UserTeam } = require("../models");
const { Op } = require("sequelize");
const db = require("../models");
const sendMail = require("../utils/mailer");

exports.logWork = async (req, res) => {
  try {
    const { projectId, taskId, hoursWorked, description, date } = req.body;

    // Validate input
    if (!projectId || !taskId || !hoursWorked || !description || !date) {
      return res.status(400).json({ message: "projectId, taskId, hoursWorked, description, and date are required" });
    }
    if (isNaN(hoursWorked) || hoursWorked <= 0) {
      return res.status(400).json({ message: "hoursWorked must be a positive number" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "date must be in YYYY-MM-DD format" });
    }

    // Check project and task existence
    const project = await Project.findByPk(projectId, { attributes: ["id", "name", "teamId"] });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const task = await Task.findByPk(taskId, { attributes: ["id", "title", "projectId", "assignedTo"] });
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.projectId !== projectId) {
      return res.status(400).json({ message: "Task does not belong to the specified project" });
    }

    // Create work log using Sequelize
    const newLog = await WorkLog.create({
      userId: req.user.id,
      projectId,
      taskId,
      hoursWorked,
      description,
      date,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Fetch log with associations
    const logWithDetails = await WorkLog.findByPk(newLog.id, {
      include: [
        { model: User, attributes: ["id", "firstName", "lastName", "email"] },
        { model: Project, attributes: ["id", "name"] },
        { model: Task, attributes: ["id", "title"] },
      ],
    });

    // Format response
    const logResponse = {
      id: logWithDetails.id,
      userId: logWithDetails.userId,
      projectId: logWithDetails.projectId,
      taskId: logWithDetails.taskId,
      hoursWorked: logWithDetails.hoursWorked,
      description: logWithDetails.description,
      date: logWithDetails.date,
      createdAt: logWithDetails.createdAt,
      updatedAt: logWithDetails.updatedAt,
      User: {
        id: logWithDetails.User.id,
        firstName: logWithDetails.User.firstName,
        lastName: logWithDetails.User.lastName,
        email: logWithDetails.User.email,
      },
      Project: {
        id: logWithDetails.Project.id,
        name: logWithDetails.Project.name,
      },
      Task: {
        id: logWithDetails.Task.id,
        title: logWithDetails.Task.title,
      },
    };

    // Notify all users except the requester
    const allUsers = await User.findAll({
      attributes: ["email"],
    });
    const emails = allUsers.map((u) => u.email).filter((email) => email && email !== req.user.email);

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🆕 New Work Log Created",
        html: `
          <p>Hello,</p>
          <p>A new work log has been created by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
          <p><strong>Project:</strong> ${project.name}</p>
          <p><strong>Task:</strong> ${task.title}</p>
          <p><strong>Hours Worked:</strong> ${hoursWorked}</p>
          <p><strong>Description:</strong> ${description}</p>
          <p><strong>Date:</strong> ${date}</p>
          <p>Best,<br>Team</p>
        `,
      });
    } else {
      console.warn("No emails found for notification", {
        userId: req.user.id,
        workLogId: newLog.id,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(201).json({ message: "Work log created successfully", log: logResponse });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "logWork", body: req.body }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ error: "Failed to create work log", details: err.message });
  }
};

exports.getUserLogs = async (req, res) => {
  try {
    const { userId, projectId, taskId, date, page = 1, limit = 20 } = req.query;

    // Validate pagination
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: "Invalid page or limit" });
    }

    // Build where clause
    const whereClause = {};
    if (userId) whereClause.userId = userId;
    if (projectId) whereClause.projectId = projectId;
    if (taskId) whereClause.taskId = taskId;
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "date must be in YYYY-MM-DD format" });
      }
      whereClause.date = { [Op.eq]: date };
    }

    // Fetch logs with Sequelize
    const { count, rows } = await WorkLog.findAndCountAll({
      where: whereClause,
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: Task, attributes: ["id", "title"] },
        { model: User, attributes: ["id", "firstName", "lastName", "email"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    // Format response
    const logs = rows.map((log) => ({
      id: log.id,
      userId: log.userId,
      projectId: log.projectId,
      taskId: log.taskId,
      hoursWorked: log.hoursWorked,
      description: log.description,
      date: log.date,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
      User: {
        id: log.User.id,
        firstName: log.User.firstName,
        lastName: log.User.lastName,
        email: log.User.email,
      },
      Project: {
        id: log.Project.id,
        name: log.Project.name,
      },
      Task: {
        id: log.Task.id,
        title: log.Task.title,
      },
    }));

    // Pagination metadata
    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(count / limitNum),
      totalItems: count,
      itemsPerPage: limitNum,
    };

    res.status(200).json({ logs, pagination });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "getUserLogs", query: req.query }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ error: "Failed to fetch user logs", details: err.message });
  }
};

exports.getProjectLogs = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // Validate input
    if (!projectId) return res.status(400).json({ message: "projectId is required" });
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: "Invalid page or limit" });
    }

    // Check project existence
    const project = await Project.findByPk(projectId, { attributes: ["id", "name"] });
    if (!project) return res.status(404).json({ message: "Project not found" });

    // Fetch logs with Sequelize
    const { count, rows } = await WorkLog.findAndCountAll({
      where: { projectId },
      include: [
        { model: User, attributes: ["id", "firstName", "lastName", "email"] },
        { model: Project, attributes: ["id", "name"] },
        { model: Task, attributes: ["id", "title"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    // Format response
    const logs = rows.map((log) => ({
      id: log.id,
      userId: log.userId,
      projectId: log.projectId,
      taskId: log.taskId,
      hoursWorked: log.hoursWorked,
      description: log.description,
      date: log.date,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
      User: {
        id: log.User.id,
        firstName: log.User.firstName,
        lastName: log.User.lastName,
        email: log.User.email,
      },
      Project: {
        id: log.Project.id,
        name: log.Project.name,
      },
      Task: {
        id: log.Task.id,
        title: log.Task.title,
      },
    }));

    // Pagination metadata
    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(count / limitNum),
      totalItems: count,
      itemsPerPage: limitNum,
    };

    res.status(200).json({ logs, pagination });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "getProjectLogs", projectId: req.params.projectId, query: req.query }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ error: "Failed to fetch project logs", details: err.message });
  }
};

exports.updateLog = async (req, res) => {
  try {
    const { logId } = req.params;
    const { hoursWorked, description, date } = req.body;

    // Validate input
    if (!logId) return res.status(400).json({ message: "logId is required" });
    if (!hoursWorked && !description && !date) {
      return res.status(400).json({ message: "At least one field (hoursWorked, description, date) is required" });
    }
    if (hoursWorked && (isNaN(hoursWorked) || hoursWorked <= 0)) {
      return res.status(400).json({ message: "hoursWorked must be a positive number" });
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "date must be in YYYY-MM-DD format" });
    }

    // Fetch log
    const [log] = await db.sequelize.query(
      `
      SELECT id, userId, projectId, taskId, hoursWorked, description, date
      FROM WorkLogs
      WHERE id = ?
      `,
      {
        replacements: [logId],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!log) return res.status(404).json({ message: "Work log not found" });

    req.body._previousData = log.toJSON();

    // Build update query
    const updateFields = [];
    const updateReplacements = [];
    if (hoursWorked) {
      updateFields.push("hoursWorked = ?");
      updateReplacements.push(hoursWorked);
    }
    if (description) {
      updateFields.push("description = ?");
      updateReplacements.push(description);
    }
    if (date) {
      updateFields.push("date = ?");
      updateReplacements.push(date);
    }
    updateFields.push("updatedAt = NOW()");

    if (updateFields.length > 1) {
      await db.sequelize.query(
        `
        UPDATE WorkLogs
        SET ${updateFields.join(", ")}
        WHERE id = ?
        `,
        {
          replacements: [...updateReplacements, logId],
          type: db.sequelize.QueryTypes.UPDATE,
        }
      );
    }

    // Fetch updated log
    const updatedLog = await WorkLog.findByPk(logId, {
      include: [
        { model: User, attributes: ["id", "firstName", "lastName", "email"] },
        { model: Project, attributes: ["id", "name"] },
        { model: Task, attributes: ["id", "title"] },
      ],
    });

    // Format response
    const logResponse = {
      id: updatedLog.id,
      userId: updatedLog.userId,
      projectId: updatedLog.projectId,
      taskId: updatedLog.taskId,
      hoursWorked: updatedLog.hoursWorked,
      description: updatedLog.description,
      date: updatedLog.date,
      createdAt: updatedLog.createdAt,
      updatedAt: updatedLog.updatedAt,
      User: {
        id: updatedLog.User.id,
        firstName: updatedLog.User.firstName,
        lastName: updatedLog.User.lastName,
        email: updatedLog.User.email,
      },
      Project: {
        id: updatedLog.Project.id,
        name: updatedLog.Project.name,
      },
      Task: {
        id: updatedLog.Task.id,
        title: updatedLog.Task.title,
      },
    };

    // Notify all users except the requester
    const allUsers = await User.findAll({
      attributes: ["email"],
    });
    const emails = allUsers.map((u) => u.email).filter(
      (email, index, self) => email && self.indexOf(email) === index && email !== req.user.email
    );

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🔄 Work Log Updated",
        html: `
          <p>Hello,</p>
          <p>The work log for <strong>${updatedLog.Task.title}</strong> in project <strong>${updatedLog.Project.name}</strong> has been updated by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
          <p><strong>Hours Worked:</strong> ${updatedLog.hoursWorked}</p>
          <p><strong>Description:</strong> ${updatedLog.description}</p>
          <p><strong>Date:</strong> ${updatedLog.date}</p>
          <p>Best,<br>Team</p>
        `,
      });
    } else {
      console.warn("No emails found for notification", {
        userId: req.user.id,
        workLogId: logId,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(200).json({ message: "Work log updated successfully", log: logResponse });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "updateLog", logId: req.params.logId, body: req.body }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ error: "Failed to update work log", details: err.message });
  }
};

exports.deleteLog = async (req, res) => {
  try {
    const { logId } = req.params;
    if (!req.body) req.body = {};

    // Validate input
    if (!logId) return res.status(400).json({ message: "logId is required" });

    // Fetch log
    const [log] = await db.sequelize.query(
      `
      SELECT id, userId, projectId, taskId, hoursWorked, description, date
      FROM WorkLogs
      WHERE id = ?
      `,
      {
        replacements: [logId],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!log) return res.status(404).json({ message: "Work log not found" });

    req.body._deletedData = log.toJSON();

    // Fetch project and task for notification
    const project = await Project.findByPk(log.projectId, { attributes: ["name"] });
    const task = await Task.findByPk(log.taskId, { attributes: ["title"] });
    const user = await User.findByPk(log.userId, { attributes: ["email"] });

    // Delete log using raw SQL
    await db.sequelize.query(
      `
      DELETE FROM WorkLogs
      WHERE id = ?
      `,
      {
        replacements: [logId],
        type: db.sequelize.QueryTypes.DELETE,
      }
    );

    // Notify all users except the requester
    const allUsers = await User.findAll({
      attributes: ["email"],
    });
    const emails = allUsers.map((u) => u.email).filter(
      (email, index, self) => email && self.indexOf(email) === index && email !== req.user.email
    );

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🗑️ Work Log Deleted",
        html: `
          <p>Hello,</p>
          <p>A work log for <strong>${task.title}</strong> in project <strong>${project.name}</strong> has been deleted by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
          <p><strong>Hours Worked:</strong> ${log.hoursWorked}</p>
          <p><strong>Description:</strong> ${log.description}</p>
          <p><strong>Date:</strong> ${log.date}</p>
          <p>Best,<br>Team</p>
        `,
      });
    } else {
      console.warn("No emails found for notification", {
        userId: req.user.id,
        workLogId: logId,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(200).json({ message: "Work log deleted successfully" });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "deleteLog", logId: req.params.logId }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ error: "Failed to delete work log", details: err.message });
  }
};
