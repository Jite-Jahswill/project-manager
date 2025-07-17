const { Task, User, Project, UserTeam, TeamProject } = require("../models");
const { Op } = require("sequelize");
const sendMail = require("../utils/mailer");

exports.createTask = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      await transaction.rollback();
      return res
        .status(403)
        .json({ message: "Only admins or managers can create tasks" });
    }

    const { title, description, dueDate, projectId, assignedTo } = req.body;

    if (!title || !projectId || !assignedTo) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ message: "title, projectId, and assignedTo are required" });
    }

    const project = await Project.findByPk(projectId, { transaction });
    if (!project) {
      await transaction.rollback();
      return res.status(404).json({ message: "Project not found" });
    }

    const user = await User.findByPk(assignedTo, {
      attributes: ["id", "firstName", "lastName", "email"],
      transaction,
    });
    if (!user) {
      await transaction.rollback();
      return res.status(404).json({ message: "Assigned user not found" });
    }

    // Validate that the user is part of a team assigned to the project
    const userTeam = await UserTeam.findOne({
      where: { userId: assignedTo, projectId },
      include: [
        {
          model: Team,
          required: true,
          include: [
            {
              model: Project,
              where: { id: projectId },
              through: { model: TeamProject, attributes: ["note"] },
              attributes: [],
            },
          ],
        },
      ],
      transaction,
    });
    if (!userTeam) {
      await transaction.rollback();
      return res.status(400).json({
        message: "Assigned user is not part of a team working on this project",
      });
    }

    const task = await Task.create(
      {
        title,
        description,
        dueDate,
        projectId,
        assignedTo,
        status: "To Do",
      },
      { transaction }
    );

    const notifyUsers = await User.findAll({
      where: { role: ["admin", "manager"] },
      attributes: ["email"],
      transaction,
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
        } ${user.lastName}</strong> in team <strong>${userTeam.Team.name}</strong>.</p>
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

    await transaction.commit();
    return res.status(201).json({
      message: "Task created successfully",
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        dueDate: task.dueDate,
        status: task.status,
        project: { id: project.id, name: project.name },
        assignee: {
          id: user.id,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
        },
        team: {
          teamId: userTeam.teamId,
          name: userTeam.Team.name,
          note: userTeam.Team.TeamProjects[0]?.note,
        },
      },
    });
  } catch (err) {
    await transaction.rollback();
    console.error("Create task error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    return res
      .status(500)
      .json({ message: "Failed to create task", details: err.message });
  }
};

exports.getProjectTasks = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const whereClause = { projectId };
    if (req.user.role === "staff") {
      whereClause.assignedTo = req.user.id;
    }

    const { count, rows } = await Task.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: "assignee",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        { model: Project, attributes: ["id", "name"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    const totalPages = Math.ceil(count / limit);

    return res.status(200).json({
      tasks: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Get project tasks error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      projectId: req.params.projectId,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    return res
      .status(500)
      .json({ message: "Failed to fetch tasks", details: err.message });
  }
};

exports.getAllTasks = async (req, res) => {
  try {
    const { title, status, dueDate, page = 1, limit = 20 } = req.query;

    const whereClause = {};
    if (title) whereClause.title = { [Op.like]: `%${title}%` };
    if (status) whereClause.status = status;
    if (dueDate) whereClause.dueDate = dueDate;
    if (req.user.role === "staff") {
      whereClause.assignedTo = req.user.id;
    }

    const { count, rows } = await Task.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: "assignee",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        { model: Project, attributes: ["id", "name"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    const totalPages = Math.ceil(count / limit);

    return res.status(200).json({
      tasks: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Get all tasks error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    return res
      .status(500)
      .json({ message: "Failed to fetch tasks", details: err.message });
  }
};

exports.updateTaskStatus = async (req, res) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can update task status" });
    }

    const { status } = req.body;
    const allowedStatuses = ["To Do", "In Progress", "Review", "Done"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        message:
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
      return res.status(404).json({ message: "Task not found" });
    }

    const oldStatus = task.status;
    await db.sequelize.query(
      "UPDATE Tasks SET status = :status WHERE id = :id",
      {
        replacements: { status, id: req.params.taskId },
        type: db.sequelize.QueryTypes.UPDATE,
      }
    );

    const updatedTask = await Task.findByPk(req.params.taskId, {
      include: [
        {
          model: User,
          as: "assignee",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        { model: Project, attributes: ["id", "name"] },
      ],
    });

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

    return res.status(200).json({
      message: "Task status updated successfully",
      task: updatedTask,
    });
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
    return res
      .status(500)
      .json({ message: "Failed to update task status", details: err.message });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can delete tasks" });
    }

    const task = await Task.findByPk(req.params.taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    await task.destroy();
    return res.status(200).json({ message: "Task deleted successfully" });
  } catch (err) {
    console.error("Delete task error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      taskId: req.params.taskId,
      timestamp: new Date().toISOString(),
    });
    return res
      .status(500)
      .json({ message: "Failed to delete task", details: err.message });
  }
};
