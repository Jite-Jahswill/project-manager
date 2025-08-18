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
    // Get total count separately to ensure accuracy
    const count = await db.User.count({ where: whereClause });
    // Fetch users with pagination
    const rows = await db.User.findAll({
      where: whereClause,
      attributes: { exclude: ["password"] },
      include: [
        {
          model: db.UserTeam,
          attributes: ["teamId", "projectId", "role", "note"],
          include: [
            {
              model: db.Team,
              attributes: ["id", "name"],
            },
            {
              model: db.Project,
              attributes: ["id", "name", "description", "startDate", "endDate", "status"],
              required: false,
            },
          ],
          required: false,
        },
        {
          model: db.Task,
          as: "Tasks",
          attributes: ["id", "title", "description", "status", "dueDate"],
          include: [
            {
              model: db.Project,
              attributes: ["id", "name"],
            },
          ],
          required: false,
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
    console.error("Get all users error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
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
    res.status(500).json({ message: "Failed to fetch user projects", details: err.message });
  }
},

async getUserTasks(req, res) {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, title, email } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Validate pagination parameters
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: "Invalid page or limit" });
    }

    // Validate userId
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // Authorization: Admins can view any user's tasks, others can only view their own
    if (req.user.role !== "admin" && req.user.id !== parseInt(userId)) {
      return res.status(403).json({ message: "Unauthorized to view this user's tasks" });
    }

    // Check if user exists
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get user's team IDs
    const userTeams = await UserTeam.findAll({
      where: { userId },
      attributes: ["teamId"],
    });

    // If user is not in any teams, return empty result
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

    // Build where clause for task filtering
    const taskWhere = {};
    if (title) {
      taskWhere.title = { [db.Sequelize.Op.like]: `%${title}%` };
    }

    // Build include clause with assignee email filter
    const include = [
      {
        model: Project,
        attributes: ["id", "name"],
        include: [
          {
            model: Team,
            as: "Teams",
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
        where: email ? { email: { [db.Sequelize.Op.like]: `%${email}%` } } : {},
        required: !!email, // Only require assignee if email filter is provided
      },
    ];

    // Fetch tasks with count
    const { count, rows } = await Task.findAndCountAll({
      where: taskWhere,
      include,
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    // Format tasks for response
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
        teamId: task.Project.Teams[0].id,
        teamName: task.Project.Teams[0].name,
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
