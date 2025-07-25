const db = require("../models");
const User = db.User;
const UserTeam = db.UserTeam;
const Project = db.Project;
const Task = db.Task;
const Team = db.Team;

module.exports = {
  // Get current user's details
  async getCurrentUser(req, res) {
    try {
      const user = await User.findByPk(req.user.id, {
        attributes: { exclude: ["password"] },
      });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json({ user });
    } catch (err) {
      await db.sequelize.query(
        "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
        {
          replacements: {
            message: err.message,
            stack: err.stack,
            userId: req.user?.id || null,
            context: JSON.stringify({ endpoint: "getCurrentUser" }),
            timestamp: new Date().toISOString(),
          },
          type: db.sequelize.QueryTypes.INSERT,
        }
      );
      res.status(500).json({ message: "Failed to fetch user", details: err.message });
    }
  },

  // Get all users (Admin only)
  async getAllUsers(req, res) {
  try {
    if (!["admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Only admins can view all users" });
    }

    const { role, firstName, lastName, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: "Invalid page or limit" });
    }

    const whereClause = {};

    if (role) {
      whereClause.role = role;
    }

    if (firstName) {
      whereClause.firstName = {
        [db.Sequelize.Op.like]: `%${firstName}%`,
      };
    }

    if (lastName) {
      whereClause.lastName = {
        [db.Sequelize.Op.like]: `%${lastName}%`,
      };
    }

    const { count, rows } = await User.findAndCountAll({
      where: whereClause,
      attributes: { exclude: ["password"] },
      include: [
        {
          model: UserTeam,
          attributes: ["teamId", "projectId", "role", "note"],
          include: [
            {
              model: Team,
              attributes: ["id", "name"],
            },
            {
              model: Project,
              attributes: ["id", "name", "description", "startDate", "endDate", "status"],
              required: false, // Allow users without projects
            },
          ],
          required: false, // Allow users without teams
        },
        {
          model: Task,
          as: "Tasks",
          attributes: ["id", "title", "description", "status", "dueDate"],
          include: [
            {
              model: Project,
              attributes: ["id", "name"],
            },
          ],
          required: false, // Allow users without tasks
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    // Transform the response to a cleaner format
    const users = rows.map((user) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      phoneNumber: user.phoneNumber,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      teams: user.UserTeams
        ? user.UserTeams.map((ut) => ({
            teamId: ut.teamId,
            teamName: ut.Team ? ut.Team.name : null,
            project: ut.Project
              ? {
                  id: ut.Project.id,
                  name: ut.Project.name,
                  description: ut.Project.description,
                  startDate: ut.Project.startDate,
                  endDate: ut.Project.endDate,
                  status: ut.Project.status,
                }
              : null,
            role: ut.role,
            note: ut.note,
          }))
        : [],
      tasks: user.Tasks
        ? user.Tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            dueDate: task.dueDate,
            project: task.Project
              ? {
                  id: task.Project.id,
                  name: task.Project.name,
                }
              : null,
          }))
        : [],
    }));

    const totalPages = Math.ceil(count / limitNum);

    res.status(200).json({
      users,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems: count,
        itemsPerPage: limitNum,
      },
    });
  } catch (err) {
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
    res.status(500).json({ message: "Failed to fetch users", details: err.message });
  }
},

  // Get one user by ID
  async getUserById(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ message: "id is required" });
      }

      if (req.user.role !== "admin" && req.user.id !== parseInt(id)) {
        return res.status(403).json({ message: "Unauthorized to view this user" });
      }

      const user = await User.findByPk(id, {
        attributes: { exclude: ["password"] },
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.status(200).json({ user });
    } catch (err) {
      await db.sequelize.query(
        "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
        {
          replacements: {
            message: err.message,
            stack: err.stack,
            userId: req.user?.id || null,
            context: JSON.stringify({ targetUserId: req.params.id }),
            timestamp: new Date().toISOString(),
          },
          type: db.sequelize.QueryTypes.INSERT,
        }
      );
      res.status(500).json({ message: "Failed to fetch user", details: err.message });
    }
  },

  // Update current user's details
  async updateCurrentUser(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      const user = await User.findByPk(req.user.id, { transaction });
      if (!user) {
        await transaction.rollback();
        return res.status(404).json({ message: "User not found" });
      }

      const { firstName, lastName, email, phoneNumber } = req.body;

      if (email && email !== user.email) {
        const existingUser = await User.findOne({ where: { email }, transaction });
        if (existingUser) {
          await transaction.rollback();
          return res.status(409).json({ message: "Email already in use" });
        }
      }

      // Build update query
      const updateFields = [];
      const updateReplacements = [];
      if (firstName) {
        updateFields.push("firstName = ?");
        updateReplacements.push(firstName);
      }
      if (lastName) {
        updateFields.push("lastName = ?");
        updateReplacements.push(lastName);
      }
      if (email) {
        updateFields.push("email = ?");
        updateReplacements.push(email);
      }
      if (phoneNumber !== undefined) {
        updateFields.push("phoneNumber = ?");
        updateReplacements.push(phoneNumber || null);
      }
      updateFields.push("updatedAt = NOW()");

      if (updateFields.length > 1) {
        await db.sequelize.query(
          `
          UPDATE Users
          SET ${updateFields.join(", ")}
          WHERE id = ?
          `,
          {
            replacements: [...updateReplacements, req.user.id],
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          }
        );
      }

      const updatedUser = await User.findByPk(req.user.id, {
        attributes: { exclude: ["password"] },
        transaction,
      });

      await transaction.commit();
      res.status(200).json({ message: "User updated", user: updatedUser });
    } catch (err) {
      await transaction.rollback();
      await db.sequelize.query(
        "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
        {
          replacements: {
            message: err.message,
            stack: err.stack,
            userId: req.user?.id || null,
            context: JSON.stringify({ endpoint: "updateCurrentUser", body: req.body }),
            timestamp: new Date().toISOString(),
          },
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );
      res.status(500).json({ message: "Failed to update user", details: err.message });
    }
  },

  // Delete current user
  async deleteCurrentUser(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      if (req.user.role !== "admin" && req.user.id !== parseInt(req.user.id)) {
        await transaction.rollback();
        return res.status(403).json({ message: "Unauthorized to delete this user" });
      }

      const user = await User.findByPk(req.user.id, { transaction });
      if (!user) {
        await transaction.rollback();
        return res.status(404).json({ message: "User not found" });
      }

      await User.destroy({ where: { id: req.user.id }, transaction });

      await transaction.commit();
      res.status(200).json({ message: "User deleted successfully" });
    } catch (err) {
      await transaction.rollback();
      await db.sequelize.query(
        "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
        {
          replacements: {
            message: err.message,
            stack: err.stack,
            userId: req.user?.id || null,
            context: JSON.stringify({ endpoint: "deleteCurrentUser" }),
            timestamp: new Date().toISOString(),
          },
          type: db.sequelize.QueryTypes.INSERT,
          transaction,
        }
      );
      res.status(500).json({ message: "Failed to delete user", details: err.message });
    }
  },

  // Get projects a user belongs to
  async getUserProjects(req, res) {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: "Invalid page or limit" });
      }

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      if (req.user.role !== "admin" && req.user.id !== parseInt(userId)) {
        return res.status(403).json({ message: "Unauthorized to view this user's projects" });
      }

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { count, rows } = await UserTeam.findAndCountAll({
        where: {
          userId,
          projectId: { [db.Sequelize.Op.ne]: null },
        },
        include: [
          {
            model: Project,
            attributes: ["id", "name", "description", "startDate", "endDate", "status"],
            include: [
              {
                model: Task,
                as: "Tasks",
                attributes: ["id", "title", "description", "status", "dueDate"],
                include: [
                  {
                    model: User,
                    as: "assignee",
                    attributes: ["id", "firstName", "lastName", "email"],
                  },
                ],
              },
            ],
          },
        ],
        order: [[{ model: Project }, "createdAt", "DESC"]],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
      });

      const projects = rows.map((ut) => ({
        project: {
          id: ut.Project.id,
          name: ut.Project.name,
          description: ut.Project.description,
          startDate: ut.Project.startDate,
          endDate: ut.Project.endDate,
          status: ut.Project.status,
          tasks: ut.Project.Tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            dueDate: task.dueDate,
            assignee: task.assignee
              ? {
                  userId: task.assignee.id,
                  firstName: task.assignee.firstName,
                  lastName: task.assignee.lastName,
                  email: task.assignee.email,
                }
              : null,
          })),
        },
        role: ut.role,
        note: ut.note,
      }));

      const totalPages = Math.ceil(count / limitNum);

      res.status(200).json({
        projects,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalItems: count,
          itemsPerPage: limitNum,
        },
      });
    } catch (err) {
      await db.sequelize.query(
        "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
        {
          replacements: {
            message: err.message,
            stack: err.stack,
            userId: req.user?.id || null,
            context: JSON.stringify({ targetUserId: req.params.userId, query: req.query }),
            timestamp: new Date().toISOString(),
          },
          type: db.sequelize.QueryTypes.INSERT,
        }
      );
      res.status(500).json({ message: "Failed to fetch user projects", details: err.message });
    }
  },

  // Get tasks for the user's team(s)
  async getUserTasks(req, res) {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: "Invalid page or limit" });
      }

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      if (req.user.role !== "admin" && req.user.id !== parseInt(userId)) {
        return res.status(403).json({ message: "Unauthorized to view this user's tasks" });
      }

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const userTeams = await UserTeam.findAll({
        where: { userId },
        attributes: ["teamId"],
      });

      if (!userTeams.length) {
        return res.status(200).json({
          tasks: [],
          pagination: {
            currentPage: pageNum,
            totalPages: 0,
            totalItems: 0,
            itemsPerPage: limitNum,
          },
        });
      }

      const teamIds = userTeams.map((ut) => ut.teamId);

      const { count, rows } = await Task.findAndCountAll({
        include: [
          {
            model: Project,
            attributes: ["id", "name"],
            include: [
              {
                model: Team,
                attributes: ["id", "name"],
                where: { id: { [db.Sequelize.Op.in]: teamIds } },
                required: true,
              },
            ],
            required: true,
          },
          {
            model: User,
            as: "assignee",
            attributes: ["id", "firstName", "lastName", "email"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
      });

      const tasks = rows.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        dueDate: task.dueDate,
        project: {
          id: task.Project.id,
          name: task.Project.name,
        },
        team: {
          teamId: task.Project.Team.id,
          teamName: task.Project.Team.name,
        },
        assignee: task.assignee
          ? {
              userId: task.assignee.id,
              firstName: task.assignee.firstName,
              lastName: task.assignee.lastName,
              email: task.assignee.email,
            }
          : null,
      }));

      const totalPages = Math.ceil(count / limitNum);

      res.status(200).json({
        tasks,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalItems: count,
          itemsPerPage: limitNum,
        },
      });
    } catch (err) {
      await db.sequelize.query(
        "INSERT INTO errors (message, stack, userId, context, timestamp) VALUES (:message, :stack, :userId, :context, :timestamp)",
        {
          replacements: {
            message: err.message,
            stack: err.stack,
            userId: req.user?.id || null,
            context: JSON.stringify({ targetUserId: req.params.userId, query: req.query }),
            timestamp: new Date().toISOString(),
          },
          type: db.sequelize.QueryTypes.INSERT,
        }
      );
      res.status(500).json({ message: "Failed to fetch user tasks", details: err.message });
    }
  },
};
