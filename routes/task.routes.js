const { Task, Project, User, UserTeam } = require("../models");
const { Op } = require("sequelize");
const db = require("../models");
const sendMail = require("../utils/mailer");

exports.createTask = async (req, res) => {
  try {
    const { title, description, dueDate, projectId, assignedTo, status = "To Do" } = req.body;

    // Validate input
    if (!title || !projectId || !assignedTo) {
      return res.status(400).json({ message: "title, projectId, and assignedTo are required" });
    }
    if (status && !["To Do", "In Progress", "Review", "Done"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    if (dueDate && isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({ message: "Invalid dueDate format" });
    }

    // Check project and user existence
    const project = await Project.findByPk(projectId, { attributes: ["id", "name", "teamId"] });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const user = await User.findByPk(assignedTo, { attributes: ["id", "firstName", "lastName", "email"] });
    if (!user) return res.status(404).json({ message: "Assigned user not found" });

    // Check if assigned user is in project team
    const isInTeam = await UserTeam.findOne({
      where: { userId: assignedTo, teamId: project.teamId },
    });
    if (!isInTeam) {
      return res.status(400).json({ message: "Assigned user is not part of the project's team" });
    }

    // Create task
    const newTask = await Task.create({
      title,
      description,
      dueDate,
      projectId,
      assignedTo,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Fetch task with associations
    const taskWithDetails = await Task.findByPk(newTask.id, {
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
      ],
    });

    // Format response
    const taskResponse = {
      id: taskWithDetails.id,
      title: taskWithDetails.title,
      description: taskWithDetails.description,
      dueDate: taskWithDetails.dueDate,
      projectId: taskWithDetails.projectId,
      assignedTo: taskWithDetails.assignedTo,
      status: taskWithDetails.status,
      createdAt: taskWithDetails.createdAt,
      updatedAt: taskWithDetails.updatedAt,
      project: {
        id: taskWithDetails.Project.id,
        name: taskWithDetails.Project.name,
      },
      assignee: {
        id: taskWithDetails.assignee.id,
        name: `${taskWithDetails.assignee.firstName} ${taskWithDetails.assignee.lastName}`,
        email: taskWithDetails.assignee.email,
      },
    };

    // Notify admins, managers, and assignee
    const adminsAndManagers = await User.findAll({
      where: { role: ["admin", "manager"] },
      attributes: ["email"],
    });
    const emails = [...adminsAndManagers.map((u) => u.email), user.email].filter(
      (email, index, self) => email && self.indexOf(email) === index && email !== req.user.email
    );

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🆕 New Task Created",
        html: `
          <p>Hello,</p>
          <p>A new task <strong>${title}</strong> has been created by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
          <p><strong>Project:</strong> ${project.name}</p>
          <p><strong>Assigned To:</strong> ${user.firstName} ${user.lastName}</p>
          <p><strong>Description:</strong> ${description || "N/A"}</p>
          <p><strong>Due Date:</strong> ${dueDate || "N/A"}</p>
          <p><strong>Status:</strong> ${status}</p>
          <p>Best,<br>Team</p>
        `,
      });
    } else {
      console.warn("No emails found for notification", {
        userId: req.user.id,
        taskId: newTask.id,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(201).json({ message: "Task created successfully", task: taskResponse });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "createTask", body: req.body }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ message: "Error creating task", details: err.message });
  }
};

exports.getProjectTasks = async (req, res) => {
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

    // Fetch tasks
    const { count, rows } = await Task.findAndCountAll({
      where: { projectId },
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    // Format response
    const tasks = rows.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      projectId: task.projectId,
      assignedTo: task.assignedTo,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      project: {
        id: task.Project.id,
        name: task.Project.name,
      },
      assignee: {
        id: task.assignee.id,
        name: `${task.assignee.firstName} ${task.assignee.lastName}`,
        email: task.assignee.email,
      },
    }));

    // Pagination metadata
    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(count / limitNum),
      totalItems: count,
      itemsPerPage: limitNum,
    };

    res.status(200).json({ tasks, pagination });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "getProjectTasks", projectId: req.params.projectId, query: req.query }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ message: "Error fetching tasks", details: err.message });
  }
};

exports.getAllTasks = async (req, res) => {
  try {
    const { title, status, dueDate, page = 1, limit = 20 } = req.query;

    // Validate pagination
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: "Invalid page or limit" });
    }

    // Build where clause
    const whereClause = {};
    if (title) whereClause.title = { [Op.like]: `%${title}%` };
    if (status) whereClause.status = status;
    if (dueDate) {
      if (isNaN(new Date(dueDate).getTime())) {
        return res.status(400).json({ message: "Invalid dueDate format" });
      }
      whereClause.dueDate = { [Op.eq]: dueDate };
    }

    // Fetch tasks
    const { count, rows } = await Task.findAndCountAll({
      where: whereClause,
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    // Format response
    const tasks = rows.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      projectId: task.projectId,
      assignedTo: task.assignedTo,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      project: {
        id: task.Project.id,
        name: task.Project.name,
      },
      assignee: {
        id: task.assignee.id,
        name: `${task.assignee.firstName} ${task.assignee.lastName}`,
        email: task.assignee.email,
      },
    }));

    // Pagination metadata
    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(count / limitNum),
      totalItems: count,
      itemsPerPage: limitNum,
    };

    res.status(200).json({ tasks, pagination });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "getAllTasks", query: req.query }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ message: "Error fetching tasks", details: err.message });
  }
};

exports.updateTaskStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;

    // Validate input
    if (!taskId) return res.status(400).json({ message: "taskId is required" });
    if (!status || !["To Do", "In Progress", "Review", "Done"].includes(status)) {
      return res.status(400).json({ message: "Valid status is required" });
    }

    // Fetch task
    const task = await Task.findByPk(taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });

    // Update status
    task.status = status;
    task.updatedAt = new Date();
    await task.save();

    // Fetch updated task with associations
    const updatedTask = await Task.findByPk(taskId, {
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
      ],
    });

    // Format response
    const taskResponse = {
      id: updatedTask.id,
      title: updatedTask.title,
      description: updatedTask.description,
      dueDate: updatedTask.dueDate,
      projectId: updatedTask.projectId,
      assignedTo: updatedTask.assignedTo,
      status: updatedTask.status,
      createdAt: updatedTask.createdAt,
      updatedAt: updatedTask.updatedAt,
      project: {
        id: updatedTask.Project.id,
        name: updatedTask.Project.name,
      },
      assignee: {
        id: updatedTask.assignee.id,
        name: `${updatedTask.assignee.firstName} ${updatedTask.assignee.lastName}`,
        email: updatedTask.assignee.email,
      },
    };

    // Notify admins, managers, and assignee
    const adminsAndManagers = await User.findAll({
      where: { role: ["admin", "manager"] },
      attributes: ["email"],
    });
    const emails = [...adminsAndManagers.map((u) => u.email), updatedTask.assignee.email].filter(
      (email, index, self) => email && self.indexOf(email) === index && email !== req.user.email
    );

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🔄 Task Status Updated",
        html: `
          <p>Hello,</p>
          <p>The status of task <strong>${updatedTask.title}</strong> in project <strong>${updatedTask.Project.name}</strong> has been updated to <strong>${status}</strong> by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
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

    res.status(200).json({ message: "Task status updated successfully", task: taskResponse });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "updateTaskStatus", taskId: req.params.taskId, body: req.body }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ message: "Error updating task status", details: err.message });
  }
};

exports.updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { title, description, dueDate, assignedTo, status } = req.body;

    // Validate input
    if (!taskId) return res.status(400).json({ message: "taskId is required" });
    if (!title && !description && !dueDate && !assignedTo && !status) {
      return res.status(400).json({ message: "At least one field is required for update" });
    }
    if (status && !["To Do", "In Progress", "Review", "Done"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    if (dueDate && isNaN(new Date(dueDate).getTime())) {
      return res.status(400).json({ message: "Invalid dueDate format" });
    }

    // Fetch task
    const task = await Task.findByPk(taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });

    // Check assigned user if provided
    let assignee = null;
    if (assignedTo) {
      assignee = await User.findByPk(assignedTo, { attributes: ["id", "firstName", "lastName", "email"] });
      if (!assignee) return res.status(404).json({ message: "Assigned user not found" });

      const project = await Project.findByPk(task.projectId, { attributes: ["teamId"] });
      const isInTeam = await UserTeam.findOne({
        where: { userId: assignedTo, teamId: project.teamId },
      });
      if (!isInTeam) {
        return res.status(400).json({ message: "Assigned user is not part of the project's team" });
      }
    }

    // Update task
    if (title) task.title = title;
    if (description !== undefined) task.description = description;
    if (dueDate) task.dueDate = dueDate;
    if (assignedTo) task.assignedTo = assignedTo;
    if (status) task.status = status;
    task.updatedAt = new Date();
    await task.save();

    // Fetch updated task with associations
    const updatedTask = await Task.findByPk(taskId, {
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
      ],
    });

    // Format response
    const taskResponse = {
      id: updatedTask.id,
      title: updatedTask.title,
      description: updatedTask.description,
      dueDate: updatedTask.dueDate,
      projectId: updatedTask.projectId,
      assignedTo: updatedTask.assignedTo,
      status: updatedTask.status,
      createdAt: updatedTask.createdAt,
      updatedAt: updatedTask.updatedAt,
      project: {
        id: updatedTask.Project.id,
        name: updatedTask.Project.name,
      },
      assignee: {
        id: updatedTask.assignee.id,
        name: `${updatedTask.assignee.firstName} ${updatedTask.assignee.lastName}`,
        email: updatedTask.assignee.email,
      },
    };

    // Notify admins, managers, and assignee
    const adminsAndManagers = await User.findAll({
      where: { role: ["admin", "manager"] },
      attributes: ["email"],
    });
    const emails = [...adminsAndManagers.map((u) => u.email), updatedTask.assignee.email].filter(
      (email, index, self) => email && self.indexOf(email) === index && email !== req.user.email
    );

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🔄 Task Updated",
        html: `
          <p>Hello,</p>
          <p>The task <strong>${updatedTask.title}</strong> in project <strong>${updatedTask.Project.name}</strong> has been updated by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
          <p><strong>Assigned To:</strong> ${updatedTask.assignee.firstName} ${updatedTask.assignee.lastName}</p>
          <p><strong>Description:</strong> ${updatedTask.description || "N/A"}</p>
          <p><strong>Due Date:</strong> ${updatedTask.dueDate || "N/A"}</p>
          <p><strong>Status:</strong> ${updatedTask.status}</p>
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

    res.status(200).json({ message: "Task updated successfully", task: taskResponse });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "updateTask", taskId: req.params.taskId, body: req.body }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ message: "Error updating task", details: err.message });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;

    // Validate input
    if (!taskId) return res.status(400).json({ message: "taskId is required" });

    // Fetch task
    const task = await Task.findByPk(taskId, {
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
      ],
    });
    if (!task) return res.status(404).json({ message: "Task not found" });

    // Delete task
    await task.destroy();

    // Notify admins, managers, and assignee
    const adminsAndManagers = await User.findAll({
      where: { role: ["admin", "manager"] },
      attributes: ["email"],
    });
    const emails = [...adminsAndManagers.map((u) => u.email), task.assignee.email].filter(
      (email, index, self) => email && self.indexOf(email) === index && email !== req.user.email
    );

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🗑️ Task Deleted",
        html: `
          <p>Hello,</p>
          <p>The task <strong>${task.title}</strong> in project <strong>${task.Project.name}</strong> has been deleted by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
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

    res.status(200).json({ message: "Task deleted successfully" });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "deleteTask", taskId: req.params.taskId }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ message: "Error deleting task", details: err.message });
  }
};

exports.assignTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { assignedTo } = req.body;

    // Validate input
    if (!taskId || !assignedTo) {
      return res.status(400).json({ message: "taskId and assignedTo are required" });
    }

    // Fetch task
    const task = await Task.findByPk(taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });

    // Check assigned user
    const assignee = await User.findByPk(assignedTo, { attributes: ["id", "firstName", "lastName", "email"] });
    if (!assignee) return res.status(404).json({ message: "Assigned user not found" });

    const project = await Project.findByPk(task.projectId, { attributes: ["teamId", "name"] });
    const isInTeam = await UserTeam.findOne({
      where: { userId: assignedTo, teamId: project.teamId },
    });
    if (!isInTeam) {
      return res.status(400).json({ message: "Assigned user is not part of the project's team" });
    }

    // Update task
    task.assignedTo = assignedTo;
    task.updatedAt = new Date();
    await task.save();

    // Fetch updated task with associations
    const updatedTask = await Task.findByPk(taskId, {
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
      ],
    });

    // Format response
    const taskResponse = {
      id: updatedTask.id,
      title: updatedTask.title,
      description: updatedTask.description,
      dueDate: updatedTask.dueDate,
      projectId: updatedTask.projectId,
      assignedTo: updatedTask.assignedTo,
      status: updatedTask.status,
      createdAt: updatedTask.createdAt,
      updatedAt: updatedTask.updatedAt,
      project: {
        id: updatedTask.Project.id,
        name: updatedTask.Project.name,
      },
      assignee: {
        id: updatedTask.assignee.id,
        name: `${updatedTask.assignee.firstName} ${updatedTask.assignee.lastName}`,
        email: updatedTask.assignee.email,
      },
    };

    // Notify admins, managers, and assignee
    const adminsAndManagers = await User.findAll({
      where: { role: ["admin", "manager"] },
      attributes: ["email"],
    });
    const emails = [...adminsAndManagers.map((u) => u.email), assignee.email].filter(
      (email, index, self) => email && self.indexOf(email) === index && email !== req.user.email
    );

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🔄 Task Assigned",
        html: `
          <p>Hello,</p>
          <p>The task <strong>${updatedTask.title}</strong> in project <strong>${updatedTask.Project.name}</strong> has been assigned to <strong>${assignee.firstName} ${assignee.lastName}</strong> by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
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

    res.status(200).json({ message: "Task assigned successfully", task: taskResponse });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "assignTask", taskId: req.params.taskId, body: req.body }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ message: "Error assigning task", details: err.message });
  }
};

exports.getTaskById = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { title, assigneeEmail } = req.query;

    // Validate input
    if (!taskId) return res.status(400).json({ message: "taskId is required" });

    // Build where clause
    const whereClause = { id: taskId };
    if (title) whereClause.title = { [Op.like]: `%${title}%` };
    if (assigneeEmail) {
      const user = await User.findOne({ where: { email: { [Op.like]: `%${assigneeEmail}%` } }, attributes: ["id"] });
      if (!user) return res.status(404).json({ message: "Task not found or does not match filters" });
      whereClause.assignedTo = user.id;
    }

    // Fetch task
    const task = await Task.findOne({
      where: whereClause,
      include: [
        { model: Project, attributes: ["id", "name"] },
        { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
      ],
    });

    if (!task) return res.status(404).json({ message: "Task not found or does not match filters" });

    // Format response
    const taskResponse = {
      id: task.id,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      projectId: task.projectId,
      assignedTo: task.assignedTo,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      project: {
        id: task.Project.id,
        name: task.Project.name,
      },
      assignee: {
        id: task.assignee.id,
        name: `${task.assignee.firstName} ${task.assignee.lastName}`,
        email: task.assignee.email,
      },
    };

    res.status(200).json({ task: taskResponse });
  } catch (err) {
    await db.sequelize.query(
      "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
      {
        replacements: {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id || null,
          context: JSON.stringify({ endpoint: "getTaskById", taskId: req.params.taskId, query: req.query }),
          timestamp: new Date().toISOString(),
        },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );
    res.status(500).json({ message: "Error fetching task", details: err.message });
  }
};
