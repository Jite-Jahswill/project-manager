const db = require("../models");
const { sendMail } = require("../utils/mailer");

// controllers/task.controller.js
exports.createTask = async (req, res) => {
  try {
    // Restrict to admins and managers
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can create tasks" });
    }

    const { title, description, dueDate, projectId, assignedTo, status } = req.body;

    // Validate input
    if (!title || !projectId || !assignedTo) {
      return res
        .status(400)
        .json({ message: "title, projectId, and assignedTo are required" });
    }

    const allowedStatuses = ["To Do", "In Progress", "Review", "Done"];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid status. Must be one of: To Do, In Progress, Review, Done",
      });
    }

    // Check if project exists
    const [project] = await db.sequelize.query(
      `SELECT id, name, teamId FROM Projects WHERE id = ?`,
      {
        replacements: [projectId],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
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
      return res.status(404).json({ message: "Assigned user not found" });
    }

    // Validate that the user is in the project's team
    const [teamMember] = await db.sequelize.query(
      `SELECT userId FROM UserTeams WHERE teamId = ? AND userId = ?`,
      {
        replacements: [project.teamId, assignedTo],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!teamMember) {
      return res
        .status(400)
        .json({ message: "Assigned user is not part of the project's team" });
    }

    // Create task
    const [task] = await db.sequelize.query(
      `
      INSERT INTO Tasks (title, description, dueDate, projectId, assignedTo, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
      RETURNING id, title, description, dueDate, projectId, assignedTo, status, createdAt, updatedAt
      `,
      {
        replacements: [
          title,
          description || null,
          dueDate || null,
          projectId,
          assignedTo,
          status || "To Do",
        ],
        type: db.sequelize.QueryTypes.INSERT,
      }
    );

    // Format response
    const formattedTask = {
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
        id: project.id,
        name: project.name,
      },
      assignee: {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
      },
    };

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
          <p><strong>Status:</strong> ${task.status}</p>
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

    res.status(201).json({ message: "Task created successfully", task: formattedTask });
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

    // Validate page and limit
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: "Invalid page or limit" });
    }

    // Check if project exists
    const [project] = await db.sequelize.query(
      `SELECT id, teamId FROM Projects WHERE id = ?`,
      {
        replacements: [projectId],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Check if user is in the project's team (for staff)
    if (!["admin", "manager"].includes(req.user.role)) {
      const [teamMember] = await db.sequelize.query(
        `SELECT userId FROM UserTeams WHERE teamId = ? AND userId = ?`,
        {
          replacements: [project.teamId, req.user.id],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!teamMember) {
        return res
          .status(403)
          .json({ message: "You're not assigned to this project" });
      }
    }

    // Build query
    let query = `
      SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId, t.assignedTo,
             t.createdAt, t.updatedAt,
             u.id AS userId, u.firstName, u.lastName, u.email,
             p.id AS projectId, p.name AS projectName
      FROM Tasks t
      LEFT JOIN Users u ON t.assignedTo = u.id
      LEFT JOIN Projects p ON t.projectId = p.id
      WHERE t.projectId = ?
    `;
    const replacements = [projectId];

    // Restrict staff to their own tasks
    if (!["admin", "manager"].includes(req.user.role)) {
      query += ` AND t.assignedTo = ?`;
      replacements.push(req.user.id);
    }

    // Add pagination
    const offset = (pageNum - 1) * limitNum;
    query += ` LIMIT ? OFFSET ?`;
    replacements.push(limitNum, offset);

    // Fetch tasks
    const tasks = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Fetch total count for pagination
    let countQuery = `SELECT COUNT(*) as total FROM Tasks WHERE projectId = ?`;
    const countReplacements = [projectId];
    if (!["admin", "manager"].includes(req.user.role)) {
      countQuery += ` AND assignedTo = ?`;
      countReplacements.push(req.user.id);
    }

    const [{ total }] = await db.sequelize.query(countQuery, {
      replacements: countReplacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Format tasks
    const formattedTasks = tasks.map((task) => ({
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
        id: task.projectId,
        name: task.projectName,
      },
      assignee: {
        id: task.userId,
        name: `${task.firstName} ${task.lastName}`,
        email: task.email,
      },
    }));

    // Pagination metadata
    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: parseInt(total, 10),
      itemsPerPage: limitNum,
    };

    res.json({ tasks: formattedTasks, pagination });
  } catch (err) {
    console.error("Get project tasks error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      projectId: req.params.projectId,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Failed to fetch tasks", details: err.message });
  }
};

exports.getAllTasks = async (req, res) => {
  try {
    const { title, status, dueDate, page = 1, limit = 20 } = req.query;

    // Validate page and limit
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: "Invalid page or limit" });
    }

    // Build query
    let query = `
      SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId, t.assignedTo,
             t.createdAt, t.updatedAt,
             u.id AS userId, u.firstName, u.lastName, u.email,
             p.id AS projectId, p.name AS projectName
      FROM Tasks t
      LEFT JOIN Users u ON t.assignedTo = u.id
      LEFT JOIN Projects p ON t.projectId = p.id
    `;
    const replacements = [];

    let whereClauses = [];
    if (title) {
      whereClauses.push(`t.title LIKE ?`);
      replacements.push(`%${title}%`);
    }
    if (status) {
      whereClauses.push(`t.status = ?`);
      replacements.push(status);
    }
    if (dueDate) {
      whereClauses.push(`DATE(t.dueDate) = ?`);
      replacements.push(dueDate);
    }
    // Restrict staff to their own tasks
    if (!["admin", "manager"].includes(req.user.role)) {
      whereClauses.push(`t.assignedTo = ?`);
      replacements.push(req.user.id);
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(" AND ")}`;
    }

    // Add pagination
    const offset = (pageNum - 1) * limitNum;
    query += ` LIMIT ? OFFSET ?`;
    replacements.push(limitNum, offset);

    // Fetch tasks
    const tasks = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Fetch total count for pagination
    let countQuery = `SELECT COUNT(*) as total FROM Tasks`;
    const countReplacements = [];
    if (whereClauses.length > 0) {
      countQuery += ` WHERE ${whereClauses.join(" AND ")}`;
      countReplacements.push(...replacements.slice(0, whereClauses.length));
    }

    const [{ total }] = await db.sequelize.query(countQuery, {
      replacements: countReplacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Format tasks
    const formattedTasks = tasks.map((task) => ({
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
        id: task.projectId,
        name: task.projectName,
      },
      assignee: {
        id: task.userId,
        name: `${task.firstName} ${task.lastName}`,
        email: task.email,
      },
    }));

    // Pagination metadata
    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: parseInt(total, 10),
      itemsPerPage: limitNum,
    };

    res.json({ tasks: formattedTasks, pagination });
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
      .json({ message: "Failed to fetch tasks", details: err.message });
  }
};

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
        message: "Invalid status. Must be one of: To Do, In Progress, Review, Done",
      });
    }

    // Fetch task with project and assignee details
    const [task] = await db.sequelize.query(
      `
      SELECT t.id, t.title, t.description, t.status AS oldStatus, t.dueDate, t.projectId, t.assignedTo,
             t.createdAt, t.updatedAt,
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
      return res.status(404).json({ message: "Task not found" });
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
      return res.status(500).json({ message: "Failed to update task status" });
    }

    // Format response
    const formattedTask = {
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
        id: task.projectId,
        name: task.projectName,
      },
      assignee: {
        id: task.assignedTo,
        name: `${task.firstName} ${task.lastName}`,
        email: task.email,
      },
    };

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
          <p><strong>Due Date:</strong> ${task.dueDate || "Not specified"}</p>
          <p><strong>Description:</strong> ${task.description || "No description"}</p>
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

    res.json({ message: "Task status updated successfully", task: formattedTask });
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
      .json({ message: "Failed to update task status", details: err.message });
  }
};

exports.updateTask = async (req, res) => {
  try {
    // Restrict to admins and managers
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can update task details" });
    }

    const { taskId } = req.params;
    const { title, description, dueDate, assignedTo, status } = req.body;

    const allowedStatuses = ["To Do", "In Progress", "Review", "Done"];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid status. Must be one of: To Do, In Progress, Review, Done",
      });
    }

    // Fetch existing task
    const [task] = await db.sequelize.query(
      `
      SELECT t.id, t.title, t.description, t.dueDate, t.projectId, t.assignedTo, t.status,
             t.createdAt, t.updatedAt,
             p.name AS projectName, p.teamId,
             u.firstName, u.lastName, u.email
      FROM Tasks t
      LEFT JOIN Projects p ON t.projectId = p.id
      LEFT JOIN Users u ON t.assignedTo = u.id
      WHERE t.id = ?
      `,
      {
        replacements: [taskId],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Validate assignedTo if provided
    let newAssignee = task;
    if (assignedTo && assignedTo !== task.assignedTo) {
      const [user] = await db.sequelize.query(
        `SELECT id, firstName, lastName, email FROM Users WHERE id = ?`,
        {
          replacements: [assignedTo],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!user) {
        return res.status(404).json({ message: "Assigned user not found" });
      }

      // Validate that the new user is in the project's team
      const [teamMember] = await db.sequelize.query(
        `SELECT userId FROM UserTeams WHERE teamId = ? AND userId = ?`,
        {
          replacements: [task.teamId, assignedTo],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!teamMember) {
        return res
          .status(400)
          .json({ message: "Assigned user is not part of the project's team" });
      }

      newAssignee = user;
    }

    // Build update query
    const updates = [];
    const replacements = [];
    if (title !== undefined) {
      updates.push("title = ?");
      replacements.push(title);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      replacements.push(description || null);
    }
    if (dueDate !== undefined) {
      updates.push("dueDate = ?");
      replacements.push(dueDate || null);
    }
    if (assignedTo !== undefined) {
      updates.push("assignedTo = ?");
      replacements.push(assignedTo);
    }
    if (status !== undefined) {
      updates.push("status = ?");
      replacements.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    updates.push("updatedAt = NOW()");
    replacements.push(taskId);

    // Update task
    const [updatedTask] = await db.sequelize.query(
      `
      UPDATE Tasks
      SET ${updates.join(", ")}
      WHERE id = ?
      RETURNING id, title, description, dueDate, projectId, assignedTo, status, createdAt, updatedAt
      `,
      {
        replacements,
        type: db.sequelize.QueryTypes.UPDATE,
      }
    );

    if (!updatedTask) {
      return res.status(500).json({ message: "Failed to update task" });
    }

    // Format response
    const formattedTask = {
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
        id: task.projectId,
        name: task.projectName,
      },
      assignee: {
        id: newAssignee.id,
        name: `${newAssignee.firstName} ${newAssignee.lastName}`,
        email: newAssignee.email,
      },
    };

    // Notify admins, managers, and assigned user
    const adminsAndManagers = await db.sequelize.query(
      `SELECT email FROM Users WHERE role IN ('admin', 'manager')`,
      {
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    const emails = [...adminsAndManagers.map((u) => u.email), newAssignee.email].filter(Boolean);

    if (emails.length > 0) {
      await sendMail({
        to: emails,
        subject: "🔄 Task Updated",
        html: `
          <p>Hello,</p>
          <p>The task <strong>${updatedTask.title}</strong> has been updated.</p>
          <p><strong>Assigned To:</strong> ${newAssignee.firstName} ${newAssignee.lastName}</p>
          <p><strong>Project:</strong> ${task.projectName}</p>
          <p><strong>Due Date:</strong> ${updatedTask.dueDate || "Not specified"}</p>
          <p><strong>Description:</strong> ${updatedTask.description || "No description"}</p>
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

    res.json({ message: "Task updated successfully", task: formattedTask });
  } catch (err) {
    console.error("Update task error:", {
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
      .json({ message: "Failed to update task", details: err.message });
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

    const { taskId } = req.params;

    // Check if task exists
    const [task] = await db.sequelize.query(
      `SELECT id FROM Tasks WHERE id = ?`,
      {
        replacements: [taskId],
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Delete task
    await db.sequelize.query(
      `DELETE FROM Tasks WHERE id = ?`,
      {
        replacements: [taskId],
        type: db.sequelize.QueryTypes.DELETE,
      }
    );

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
      .json({ message: "Failed to delete task", details: err.message });
  }
};
