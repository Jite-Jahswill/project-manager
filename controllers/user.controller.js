const db = require("../models");
const User = db.User;
const UserTeam = db.UserTeam;
const Project = db.Project;

// Get all users (Admin only)
exports.getAllUsers = async (req, res) => {
  try {
    if (!["admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Only admins can view all users" });
    }

    const { role, firstName, lastName, page = 1, limit = 20 } = req.query;
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
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    const totalPages = Math.ceil(count / limit);

    res.status(200).json({
      users: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    // Log error to errors table (assumed)
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
    res
      .status(500)
      .json({ message: "Failed to fetch users", details: err.message });
  }
};

// Get one user (Authenticated)
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "id is required" });
    }

    const user = await User.findByPk(id, {
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.user.role === "staff" && req.user.id !== parseInt(id)) {
      return res.status(403).json({ message: "Unauthorized to view this user" });
    }

    res.status(200).json(user);
  } catch (err) {
    // Log error to errors table (assumed)
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
    res
      .status(500)
      .json({ message: "Failed to fetch user", details: err.message });
  }
};

// Get projects a user belongs to
exports.getUserProjects = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.user.role === "staff" && req.user.id !== parseInt(userId)) {
      return res
        .status(403)
        .json({ message: "Unauthorized to view this user's projects" });
    }

    const { count, rows } = await UserTeam.findAndCountAll({
      where: {
        userId,
        projectId: { [db.Sequelize.Op.ne]: null }, // Exclude null projectId
      },
      include: [
        {
          model: Project,
          attributes: ["id", "name", "description"],
          required: true, // Ensure Project exists
        },
      ],
      order: [[{ model: Project }, "createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    const projects = rows.map((ut) => ({
      project: {
        id: ut.Project.id,
        name: ut.Project.name,
        description: ut.Project.description,
      },
      role: ut.role,
      note: ut.note,
    }));

    const totalPages = Math.ceil(count / limit);

    res.status(200).json({
      projects,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    // Log error to errors table (assumed)
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
    res
      .status(500)
      .json({ message: "Failed to fetch user projects", details: err.message });
  }
};
