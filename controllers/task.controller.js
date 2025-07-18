const { Task, User, Project } = require("../models");
const { Op } = require("sequelize");
const sendMail = require("../utils/mailer");

// controllers/task.controller.js
exports.createTask = async (req, res) => {
  try {
    // Restrict to admins and managers
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can create tasks" });
    }

    const { title, description, dueDate, projectId, assignedTo } = req.body;

    // Validate input
    if (!title || !projectId || !assignedTo) {
      return res
        .status(400)
        .json({ message: "title, projectId, and assignedTo are required" });
    }

    // Check if project exists
    const [project] = await db.sequelize.query(
      `SELECT id, name, teamId FROM Tasks WHERE id = ?`,
      {
        replacements: [projectId],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Check if assigned user exists
    const [user] = await db.sequelize.query(
      `SELECT id, firstName, lastName, email FROM Users WHERE id = ?`,
      {
        replacements: [assignedTo],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!user) {
      return res.status(404).json({ error: "Assigned user not found" });
    }

    // Validate that the user is in the project's team
    const [teamMember] = await db.sequelize.query(
      `
      SELECT ut.userId
      FROM UserTeams ut
      WHERE ut.teamId = ? AND ut.userId = ?
      `,
      {
        replacements: [project.teamId, assignedTo],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!teamMember) {
      return res
        .status(400)
        .json({ error: "Assigned user is not part of the project's team" });
    }

    // Create task
    const [task] = await db.sequelize.query(
      `
      INSERT INTO Tasks (title, description, dueDate, projectId, assignedTo, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 'To Do', NOW(), NOW())
      RETURNING id, title, description, dueDate, projectId, assignedTo, status, createdAt, updatedAt
      `,
      {
        replacements: [title, description || null, dueDate || null, projectId, assignedTo],
        type: db.sequelize.QueryTypes.INSERT,
      }
    );

    // Notify admins, managers, and assigned user
    const adminsAndManagers = await db.sequelize.query(
      `SELECT email FROM Users WHERE role IN ('admin', 'manager')`,
      {
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    const emails = [...adminsAndManagers.map((u) => u.email), user.email].filter(Boolean);

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🆕 New Task Created",
        html: `
          <p>Hello,</p>
          <p>A new task titled <strong>${task.title}</strong> has been created and assigned to <strong>${user.firstName} ${user.lastName}</strong>.</p>
          <p><strong>Project:</strong> ${project.name}</p>
          <p><strong>Due Date:</strong> ${task.dueDate || "Not specified"}</p>
          <p><strong>Description:</strong> ${task.description || "No description"}</p>
          <p>Best,<br>Team</p>
        `,
      });
    } else {
      console.warn("No emails found for notification", {
        userId: req.user.id,
        taskId: task.id,
        projectId,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(201).json({ message: "Task created", task });
  } catch (err) {
    console.error("Create task error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to create task", details: err.message });
  }
};

exports.getProjectTasks = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const tasks = await Task.findAll({
      where: { projectId },
      include: [
        {
          model: User,
          as: "assignee",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        { model: Project, attributes: ["id", "name"] },
      ],
    });

    res.json(tasks);
  } catch (err) {
    console.error("Get project tasks error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      projectId: req.params.projectId,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to fetch tasks", details: err.message });
  }
};

// controllers/task.controller.js
exports.updateTaskStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { taskId } = req.params;
    const allowedStatuses = ["To Do", "In Progress", "Review", "Done"];

    if (!status) {
      return res.status(400).json({ message: "Status is required" });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status. Must be one of: To Do, In Progress, Review, Done",
      });
    }

    // Fetch task with project and assignee details
    const [task] = await db.sequelize.query(
      `
      SELECT t.id, t.title, t.status AS oldStatus, t.assignedTo, t.projectId,
             u.firstName, u.lastName, u.email,
             p.name AS projectName
      FROM Tasks t
      LEFT JOIN Users u ON t.assignedTo = u.id
      LEFT JOIN Projects p ON t.projectId = p.id
      WHERE t.id = ?
      `,
      {
        replacements: [taskId],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    // Check if user is authorized (admin, manager, or assignee)
    if (
      !["admin", "manager"].includes(req.user.role) &&
      req.user.id !== task.assignedTo
    ) {
      return res.status(403).json({
        message: "Only admins, managers, or the assigned user can update task status",
      });
    }

    // Update task status
    const [updatedTask] = await db.sequelize.query(
      `
      UPDATE Tasks
      SET status = ?, updatedAt = NOW()
      WHERE id = ?
      RETURNING id, title, description, dueDate, projectId, assignedTo, status, createdAt, updatedAt
      `,
      {
        replacements: [status, taskId],
        type: db.sequelize.QueryTypes.UPDATE,
      }
    );

    if (!updatedTask) {
      return res.status(500).json({ error: "Failed to update task status" });
    }

    // Notify admins, managers, and assigned user
    const adminsAndManagers = await db.sequelize.query(
      `SELECT email FROM Users WHERE role IN ('admin', 'manager')`,
      {
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    const emails = [...adminsAndManagers.map((u) => u.email), task.email].filter(Boolean);

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "✅ Task Status Updated",
        html: `
          <p>Hello,</p>
          <p>The task <strong>${task.title}</strong> has been updated from <em>${task.oldStatus}</em> to <strong>${status}</strong>.</p>
          <p><strong>Assigned To:</strong> ${task.firstName} ${task.lastName}</p>
          <p><strong>Project:</strong> ${task.projectName}</p>
          <p>Best,<br>Team</p>
        `,
      });
    } else {
      console.warn("No emails found for notification", {
        userId: req.user.id,
        taskId,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ message: "Task status updated", task: updatedTask });
  } catch (err) {
    console.error("Update task status error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      taskId: req.params.taskId,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to update task status", details: err.message });
  }
};

// controllers/task.controller.js
exports.getProjectTasks = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    // Check if project exists
    const [project] = await db.sequelize.query(
      `SELECT id FROM Projects WHERE id = ?`,
      {
 | replacements: [projectId],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Fetch tasks with assignee and project details
    const tasks = await db.sequelize.query(
      `
      SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId, t.assignedTo,
             u.id AS userId, u.firstName, u.lastName, u.email,
             p.id AS projectId, p.name AS projectName
      FROM Tasks t
      LEFT JOIN Users u ON t.assignedTo = u.id
      LEFT JOIN Projects p ON t.projectId = p.id
      WHERE t.projectId = ?
      `,
      {
        replacements: [projectId],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    res.json(tasks);
  } catch (err) {
    console.error("Get project tasks error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      projectId: req.params.projectId,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to fetch tasks", details: err.message });
  }
};

exports.getAllTasks = async (req, res) => {
  try {
    const { title, status, dueDate } = req.query;

    const whereClause = {};
    if (title) whereClause.title = { [Op.like]: `%${title}%` };
    if (status) whereClause.status = status;
    if (dueDate) whereClause.dueDate = dueDate;

    const tasks = await Task.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: "assignee",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        { model: Project, attributes: ["id", "name"] },
      ],
    });

    res.json(tasks);
  } catch (err) {
    console.error("Get all tasks error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to fetch tasks", details: err.message });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    // Restrict to admins and managers
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can delete tasks" });
    }

    const task = await Task.findByPk(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    await task.destroy();
    res.json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error("Delete task error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      taskId: req.params.taskId,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to delete task", details: err.message });
  }
};
