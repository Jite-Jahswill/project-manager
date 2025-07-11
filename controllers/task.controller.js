const { Task, User, Project } = require("../models");
const { Op } = require("sequelize");
const sendMail = require("../utils/mailer");

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

    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const user = await User.findByPk(assignedTo, {
      attributes: ["id", "firstName", "lastName", "email"],
    });
    if (!user) {
      return res.status(404).json({ error: "Assigned user not found" });
    }

    const task = await Task.create({
      title,
      description,
      dueDate,
      projectId,
      assignedTo,
      status: "To Do",
    });

    // Notify admins, managers, and assigned user
    const notifyUsers = await User.findAll({
      where: { role: ["admin", "manager"] },
      attributes: ["email"],
    });

    const emails = [...notifyUsers.map((u) => u.email), user.email].filter(
      Boolean
    );

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🆕 New Task Created",
        html: `
          <p>Hello,</p>
          <p>A new task titled <strong>${
            task.title
          }</strong> has been created and assigned to <strong>${
          user.firstName
        } ${user.lastName}</strong>.</p>
          <p><strong>Project:</strong> ${project.name}</p>
          <p><strong>Due Date:</strong> ${task.dueDate || "Not specified"}</p>
          <p><strong>Description:</strong> ${
            task.description || "No description"
          }</p>
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

exports.updateTaskStatus = async (req, res) => {
  try {
    // Restrict to admins and managers
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can update task status" });
    }

    const { status } = req.body;
    const allowedStatuses = ["To Do", "In Progress", "Review", "Done"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error:
          "Invalid status. Must be one of: To Do, In Progress, Review, Done",
      });
    }

    const task = await Task.findByPk(req.params.taskId, {
      include: [
        {
          model: User,
          as: "assignee",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        { model: Project, attributes: ["id", "name"] },
      ],
    });

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    const oldStatus = task.status;
    await task.update({ status });

    // Notify admins, managers, and assigned user
    const notifyUsers = await User.findAll({
      where: { role: ["admin", "manager"] },
      attributes: ["email"],
    });

    const emails = [
      ...notifyUsers.map((u) => u.email),
      task.assignee.email,
    ].filter(Boolean);

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "✅ Task Status Updated",
        html: `
          <p>Hello,</p>
          <p>The task <strong>${task.title}</strong> has been updated from <em>${oldStatus}</em> to <strong>${status}</strong>.</p>
          <p><strong>Assigned To:</strong> ${task.assignee.firstName} ${task.assignee.lastName}</p>
          <p><strong>Project:</strong> ${task.Project.name}</p>
          <p>Best,<br>Team</p>
        `,
      });
    } else {
      console.warn("No emails found for notification", {
        userId: req.user.id,
        taskId: req.params.taskId,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ message: "Task status updated", task });
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
