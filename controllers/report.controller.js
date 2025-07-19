const db = require("../models");
const sendMail = require("../utils/mailer");

module.exports = {
  // Create a new task (Staff, Admin, Manager)
  async createTask(req, res) {
    try {
      const { title, description, dueDate, projectId, assignedTo, status } = req.body;

      // Validate input
      if (!title || !projectId || !assignedTo) {
        return res.status(400).json({ message: "title, projectId, and assignedTo are required" });
      }

      const allowedStatuses = ["To Do", "In Progress", "Review", "Done"];
      if (status && !allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "Invalid status. Must be one of: To Do, In Progress, Review, Done",
        });
      }

      // Check if project exists
      const project = await db.Project.findByPk(projectId, {
        attributes: ["id", "name", "teamId"],
      });
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check if assigned user exists
      const user = await db.User.findByPk(assignedTo, {
        attributes: ["id", "firstName", "lastName", "email"],
      });
      if (!user) {
        return res.status(404).json({ message: "Assigned user not found" });
      }

      // Validate that the user is in the project's team
      const teamMember = await db.UserTeam.findOne({
        where: { teamId: project.teamId, userId: assignedTo },
      });
      if (!teamMember) {
        return res.status(400).json({ message: "Assigned user is not part of the project's team" });
      }

      // For staff, ensure they are assigned to the project and assigning to themselves
      if (req.user.role === "staff") {
        const userInTeam = await db.UserTeam.findOne({
          where: { teamId: project.teamId, userId: req.user.id },
        });
        if (!userInTeam) {
          return res.status(403).json({ message: "You are not assigned to this project" });
        }
        if (assignedTo !== req.user.id) {
          return res.status(403).json({ message: "Staff can only assign tasks to themselves" });
        }
      }

      // Create task using Sequelize
      const task = await db.Task.create({
        title,
        description: description || null,
        dueDate: dueDate || null,
        projectId,
        assignedTo,
        status: status || "To Do",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

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
        project: { id: project.id, name: project.name },
        assignee: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email },
      };

      // Notify admins, managers, and assigned user
      const adminsAndManagers = await db.User.findAll({
        where: { role: ["admin", "manager"] },
        attributes: ["email"],
      });
      const emails = [...adminsAndManagers.map((u) => u.email), user.email].filter(Boolean);

      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: "🆕 New Task Created",
          html: `
            <p>Hello,</p>
            <p>A new task titled <strong>${task.title}</strong> has been created by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
            <p><strong>Assigned To:</strong> ${user.firstName} ${user.lastName}</p>
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
      res.status(500).json({ message: "Error creating task", details: err.message });
    }
  },

  // Get all tasks for a specific project (Staff see own, Admins/Managers see all)
  async getProjectTasks(req, res) {
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
      const project = await db.Project.findByPk(projectId, {
        attributes: ["id", "name", "teamId"],
      });
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check if user is in the project's team (for staff)
      if (req.user.role === "staff") {
        const teamMember = await db.UserTeam.findOne({
          where: { teamId: project.teamId, userId: req.user.id },
        });
        if (!teamMember) {
          return res.status(403).json({ message: "You are not assigned to this project" });
        }
      }

      // Build query with Sequelize
      const whereClause = { projectId };
      if (req.user.role === "staff") {
        whereClause.assignedTo = req.user.id;
      }

      const { count, rows } = await db.Task.findAndCountAll({
        where: whereClause,
        include: [
          { model: db.User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
          { model: db.Project, attributes: ["id", "name"] },
        ],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
        order: [["createdAt", "DESC"]],
      });

      // Format tasks
      const formattedTasks = rows.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        dueDate: task.dueDate,
        projectId: task.projectId,
        assignedTo: task.assignedTo,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        project: { id: task.Project.id, name: task.Project.name },
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
      res.status(500).json({ message: "Error fetching tasks", details: err.message });
    }
  },

  // Get all tasks with optional filters (Staff see own, Admins/Managers see all)
  async getAllTasks(req, res) {
    try {
      const { title, status, dueDate, page = 1, limit = 20 } = req.query;

      // Validate page and limit
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: "Invalid page or limit" });
      }

      // Build query with Sequelize
      const whereClause = {};
      if (title) {
        whereClause.title = { [db.Sequelize.Op.like]: `%${title}%` };
      }
      if (status) {
        whereClause.status = status;
      }
      if (dueDate) {
        whereClause.dueDate = { [db.Sequelize.Op.eq]: dueDate };
      }
      if (req.user.role === "staff") {
        whereClause.assignedTo = req.user.id;
      }

      const { count, rows } = await db.Task.findAndCountAll({
        where: whereClause,
        include: [
          { model: db.User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
          { model: db.Project, attributes: ["id", "name"] },
        ],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
        order: [["createdAt", "DESC"]],
      });

      // Format tasks
      const formattedTasks = rows.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        dueDate: task.dueDate,
        projectId: task.projectId,
        assignedTo: task.assignedTo,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        project: { id: task.Project.id, name: task.Project.name },
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

      res.json({ tasks: formattedTasks, pagination });
    } catch (err) {
      console.error("Get all tasks error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error fetching tasks", details: err.message });
    }
  },

  // Update task status (Staff for own tasks, Admins/Managers for any)
  async updateTaskStatus(req, res) {
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

      // Fetch task with raw SQL
      const [task] = await db.sequelize.query(
        `
        SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId, t.assignedTo,
               t.createdAt, t.updatedAt,
               u.id AS userId, u.firstName, u.lastName, u.email,
               p.id AS projectId, p.name AS projectName
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

      // Check authorization
      if (req.user.role === "staff" && req.user.id !== task.assignedTo) {
        return res.status(403).json({ message: "Unauthorized to update this task's status" });
      }

      // Update task status with raw SQL
      await db.sequelize.query(
        `
        UPDATE Tasks
        SET status = ?, updatedAt = NOW()
        WHERE id = ?
        `,
        {
          replacements: [status, taskId],
          type: db.sequelize.QueryTypes.UPDATE,
        }
      );

      // Fetch updated task
      const [updatedTask] = await db.sequelize.query(
        `
        SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId, t.assignedTo,
               t.createdAt, t.updatedAt,
               u.id AS userId, u.firstName, u.lastName, u.email,
               p.id AS projectId, p.name AS projectName
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

      if (!updatedTask) {
        return res.status(500).json({ message: "Error updating task status" });
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
        project: { id: updatedTask.projectId, name: updatedTask.projectName },
        assignee: {
          id: updatedTask.userId,
          name: `${updatedTask.firstName} ${updatedTask.lastName}`,
          email: updatedTask.email,
        },
      };

      // Notify admins, managers, and assignee
      const adminsAndManagers = await db.User.findAll({
        where: { role: ["admin", "manager"] },
        attributes: ["email"],
      });
      const emails = [...adminsAndManagers.map((u) => u.email), updatedTask.email].filter(
        (email, index, self) => email && self.indexOf(email) === index
      );

      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: "✅ Task Status Updated",
          html: `
            <p>Hello,</p>
            <p>The task <strong>${updatedTask.title}</strong> has been updated from <em>${task.status}</em> to <strong>${status}</strong> by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
            <p><strong>Assigned To:</strong> ${updatedTask.firstName} ${updatedTask.lastName}</p>
            <p><strong>Project:</strong> ${updatedTask.projectName}</p>
            <p><strong>Due Date:</strong> ${updatedTask.dueDate || "Not specified"}</p>
            <p><strong>Description:</strong> ${updatedTask.description || "No description"}</p>
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
      res.status(500).json({ message: "Error updating task status", details: err.message });
    }
  },

  // Update task details (Staff for own tasks, Admins/Managers for any)
  async updateTask(req, res) {
    try {
      const { taskId } = req.params;
      const { title, description, dueDate, assignedTo, status } = req.body;

      // Validate input
      if (!title && !description && !dueDate && !assignedTo && !status) {
        return res.status(400).json({ message: "At least one field is required for update" });
      }

      const allowedStatuses = ["To Do", "In Progress", "Review", "Done"];
      if (status && !allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "Invalid status. Must be one of: To Do, In Progress, Review, Done",
        });
      }

      // Fetch task with raw SQL
      const [task] = await db.sequelize.query(
        `
        SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId, t.assignedTo,
               t.createdAt, t.updatedAt,
               u.id AS userId, u.firstName, u.lastName, u.email,
               p.id AS projectId, p.name AS projectName, p.teamId
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

      // Check authorization
      if (req.user.role === "staff" && req.user.id !== task.assignedTo) {
        return res.status(403).json({ message: "Unauthorized to update this task" });
      }

      // Staff cannot change assignedTo or projectId
      if (req.user.role === "staff" && (assignedTo || projectId)) {
        return res.status(403).json({ message: "Staff cannot reassign tasks or change project" });
      }

      // Validate assignedTo for admins/managers
      let newAssignee = { userId: task.userId, firstName: task.firstName, lastName: task.lastName, email: task.email };
      if (assignedTo && assignedTo !== task.assignedTo) {
        if (req.user.role === "staff") {
          return res.status(403).json({ message: "Staff cannot reassign tasks" });
        }
        const [user] = await db.sequelize.query(
          `
          SELECT id, firstName, lastName, email
          FROM Users
          WHERE id = ?
          `,
          {
            replacements: [assignedTo],
            type: db.sequelize.QueryTypes.SELECT,
          }
        );
        if (!user) {
          return res.status(404).json({ message: "Assigned user not found" });
        }
        const [teamMember] = await db.sequelize.query(
          `
          SELECT userId
          FROM UserTeams
          WHERE teamId = ? AND userId = ?
          `,
          {
            replacements: [task.teamId, assignedTo],
            type: db.sequelize.QueryTypes.SELECT,
          }
        );
        if (!teamMember) {
          return res.status(400).json({ message: "Assigned user is not part of the project's team" });
        }
        newAssignee = user;
      }

      // Build update query
      const updateFields = [];
      const updateReplacements = [];
      if (title) {
        updateFields.push("title = ?");
        updateReplacements.push(title);
      }
      if (description !== undefined) {
        updateFields.push("description = ?");
        updateReplacements.push(description || null);
      }
      if (dueDate !== undefined) {
        updateFields.push("dueDate = ?");
        updateReplacements.push(dueDate || null);
      }
      if (assignedTo && req.user.role !== "staff") {
        updateFields.push("assignedTo = ?");
        updateReplacements.push(assignedTo);
      }
      if (status) {
        updateFields.push("status = ?");
        updateReplacements.push(status);
      }
      updateFields.push("updatedAt = NOW()");

      if (updateFields.length === 1) {
        return res.status(400).json({ message: "No valid fields provided for update" });
      }

      await db.sequelize.query(
        `
        UPDATE Tasks
        SET ${updateFields.join(", ")}
        WHERE id = ?
        `,
        {
          replacements: [...updateReplacements, taskId],
          type: db.sequelize.QueryTypes.UPDATE,
        }
      );

      // Fetch updated task
      const [updatedTask] = await db.sequelize.query(
        `
        SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId, t.assignedTo,
               t.createdAt, t.updatedAt,
               u.id AS userId, u.firstName, u.lastName, u.email,
               p.id AS projectId, p.name AS projectName
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

      if (!updatedTask) {
        return res.status(500).json({ message: "Error updating task" });
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
        project: { id: updatedTask.projectId, name: updatedTask.projectName },
        assignee: {
          id: newAssignee.userId || newAssignee.id,
          name: `${newAssignee.firstName} ${newAssignee.lastName}`,
          email: newAssignee.email,
        },
      };

      // Notify admins, managers, and assignee
      const adminsAndManagers = await db.User.findAll({
        where: { role: ["admin", "manager"] },
        attributes: ["email"],
      });
      const emails = [...adminsAndManagers.map((u) => u.email), newAssignee.email].filter(
        (email, index, self) => email && self.indexOf(email) === index
      );

      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: "🔄 Task Updated",
          html: `
            <p>Hello,</p>
            <p>The task <strong>${updatedTask.title}</strong> has been updated by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
            <p><strong>Assigned To:</strong> ${newAssignee.firstName} ${newAssignee.lastName}</p>
            <p><strong>Project:</strong> ${updatedTask.projectName}</p>
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
      res.status(500).json({ message: "Error updating task", details: err.message });
    }
  },

  // Delete a task (Staff for own tasks, Admins/Managers for any)
  async deleteTask(req, res) {
    try {
      const { taskId } = req.params;

      // Fetch task with raw SQL
      const [task] = await db.sequelize.query(
        `
        SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId, t.assignedTo,
               t.createdAt, t.updatedAt,
               u.id AS userId, u.firstName, u.lastName, u.email,
               p.id AS projectId, p.name AS projectName
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

      // Check authorization
      if (req.user.role === "staff" && req.user.id !== task.assignedTo) {
        return res.status(403).json({ message: "Unauthorized to delete this task" });
      }

      // Delete task with raw SQL
      await db.sequelize.query(
        `
        DELETE FROM Tasks
        WHERE id = ?
        `,
        {
          replacements: [taskId],
          type: db.sequelize.QueryTypes.DELETE,
        }
      );

      // Notify admins, managers, and assignee (if not the deleter)
      const adminsAndManagers = await db.User.findAll({
        where: { role: ["admin", "manager"] },
        attributes: ["email"],
      });
      const emails = [...adminsAndManagers.map((u) => u.email), task.email].filter(
        (email) => email !== req.user.email && email
      );

      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: "🗑️ Task Deleted",
          html: `
            <p>Hello,</p>
            <p>The task <strong>${task.title}</strong> has been deleted by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
            <p><strong>Assigned To:</strong> ${task.firstName} ${task.lastName}</p>
            <p><strong>Project:</strong> ${task.projectName}</p>
            <p><strong>Due Date:</strong> ${task.dueDate || "Not specified"}</p>
            <p><strong>Description:</strong> ${task.description || "No description"}</p>
            <p><strong>Status:</strong> ${task.status}</p>
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

      res.json({ message: "Task deleted successfully" });
    } catch (err) {
      console.error("Delete task error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        taskId: req.params.taskId,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error deleting task", details: err.message });
    }
  },
};
