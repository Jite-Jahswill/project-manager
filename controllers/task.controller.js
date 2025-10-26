const db = require("../models");
const sendMail = require("../utils/mailer");

module.exports = {
  // Create a new task (open to any authenticated user)
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
        attributes: ["id", "name"],
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
      const teamMember = await db.TeamProject.findOne({
        include: [
          {
            model: db.Team,
            include: [
              {
                model: db.User,
                through: db.UserTeam,
                where: { id: assignedTo },
              },
            ],
          },
        ],
        where: { projectId },
      });
      if (!teamMember) {
        return res.status(400).json({ message: "Assigned user is not part of the project's team" });
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
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error creating task", details: err.message });
    }
  },

  // Get all tasks for a specific project (open to any authenticated user)
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
        attributes: ["id", "name"],
      });
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Build query with Sequelize
      const whereClause = { projectId };

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

  // Get all tasks with optional filters (open to any authenticated user)
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

  // Update task status (open to any authenticated user)
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

      res.json({ message: "Task status updated successfully", task: formattedTask });
    } catch (err) {
      console.error("Update task status error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        taskId: req.params.taskId,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error updating task status", details: err.message });
    }
  },

  // Update task details (open to any authenticated user)
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

      // Validate assignedTo if provided
      let newAssignee = { userId: task.userId, firstName: task.firstName, lastName: task.lastName, email: task.email };
      if (assignedTo && assignedTo !== task.assignedTo) {
        const [user] = await db.sequelize.query(
          `
          SELECT u.id, u.firstName, u.lastName, u.email
          FROM Users u
          WHERE u.id = ?
          `,
          {
            replacements: [assignedTo],
            type: db.sequelize.QueryTypes.SELECT,
          }
        );
        if (!user) {
          return res.status(404).json({ message: "Assigned user not found" });
        }
        // Validate that the new assignee is in the project's team
        const [teamMember] = await db.sequelize.query(
          `
          SELECT ut.userId
          FROM UserTeams ut
          JOIN TeamProjects tp ON ut.teamId = tp.teamId
          WHERE tp.projectId = ? AND ut.userId = ?
          `,
          {
            replacements: [task.projectId, assignedTo],
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
      if (assignedTo) {
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

      // Perform update with raw SQL
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
        taskId: req.params.taskId,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error updating task", details: err.message });
    }
  },

  // Delete a task (open to any authenticated user)
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

  // Assign task to a user in the project's team (open to any authenticated user)
  async assignTask(req, res) {
    try {
      const { taskId } = req.params;
      const { assignedTo } = req.body;

      // Validate input
      if (!taskId || !assignedTo) {
        return res.status(400).json({ message: "taskId and assignedTo are required" });
      }

      // Fetch task with project and assignee details
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

      // Validate new assignee exists
      const [newUser] = await db.sequelize.query(
        `
        SELECT u.id, u.firstName, u.lastName, u.email
        FROM Users u
        WHERE u.id = ?
        `,
        {
          replacements: [assignedTo],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!newUser) {
        return res.status(404).json({ message: "Assigned user not found" });
      }

      // Validate new assignee is in the project's team
      const [teamMember] = await db.sequelize.query(
        `
        SELECT ut.userId
        FROM UserTeams ut
        JOIN TeamProjects tp ON ut.teamId = tp.teamId
        WHERE tp.projectId = ? AND ut.userId = ?
        `,
        {
          replacements: [task.projectId, assignedTo],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!teamMember) {
        return res.status(400).json({ message: "Assigned user is not part of the project's team" });
      }

      // Update task assignee with raw SQL
      await db.sequelize.query(
        `
        UPDATE Tasks
        SET assignedTo = ?, updatedAt = NOW()
        WHERE id = ?
        `,
        {
          replacements: [assignedTo, taskId],
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
        return res.status(500).json({ message: "Error assigning task" });
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

      // Notify admins, managers, and new assignee
      const adminsAndManagers = await db.User.findAll({
        where: { role: ["admin", "manager"] },
        attributes: ["email"],
      });
      const emails = [...adminsAndManagers.map((u) => u.email), newUser.email].filter(
        (email, index, self) => email && self.indexOf(email) === index
      );

      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: "🔄 Task Reassigned",
          html: `
            <p>Hello,</p>
            <p>The task <strong>${updatedTask.title}</strong> has been reassigned to <strong>${newUser.firstName} ${newUser.lastName}</strong> by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
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

      res.status(200).json({ message: "Task assigned successfully", task: formattedTask });
    } catch (err) {
      console.error("Assign task error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        taskId: req.params.taskId,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error assigning task", details: err.message });
    }
  },

  // Get task by ID with optional search filters (open to any authenticated user)
  async getTaskById(req, res) {
    try {
      const { taskId } = req.params;
      const { title, assigneeEmail } = req.query;

      if (!taskId) {
        return res.status(400).json({ message: "taskId is required" });
      }

      // Build WHERE clause for filtering
      let whereClause = `t.id = ?`;
      const replacements = [taskId];

      if (title) {
        whereClause += ` AND t.title LIKE ?`;
        replacements.push(`%${title}%`);
      }

      if (assigneeEmail) {
        whereClause += ` AND u.email LIKE ?`;
        replacements.push(`%${assigneeEmail}%`);
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
        WHERE ${whereClause}
        `,
        {
          replacements,
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!task) {
        return res.status(404).json({ message: "Task not found or does not match filters" });
      }

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
        project: { id: task.projectId, name: task.projectName },
        assignee: {
          id: task.userId,
          name: `${task.firstName} ${task.lastName}`,
          email: task.email,
        },
      };

      res.status(200).json({ task: formattedTask });
    } catch (err) {
      console.error("Get task by ID error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        taskId: req.params.taskId,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error fetching task", details: err.message });
    }
  },
};
