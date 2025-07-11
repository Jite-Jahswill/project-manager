// controllers/user.controller.js
const db = require("../models");
const User = db.User;
const UserTeam = db.UserTeam;
const Project = db.Project;

// Get all users (Admin only)
exports.getAllUsers = async (req, res) => {
  try {
    if (!["admin"].includes(req.user.role)) {
      return res.status(403).json({ error: "Only admins can view all users" });
    }

    const { role, firstName, lastName } = req.query;
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

    const users = await User.findAll({
      where: whereClause,
      attributes: { exclude: ["password"] },
    });

    res.json(users);
  } catch (err) {
    console.error("Get all users error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to fetch users", details: err.message });
  }
};

// Get one user (Authenticated)
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("Get user error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to fetch user", details: err.message });
  }
};

// Get projects a user belongs to
exports.getUserProjects = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const userTeams = await UserTeam.findAll({
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
    });

    const projects = userTeams.map((ut) => ({
      project: {
        id: ut.Project.id,
        name: ut.Project.name,
        description: ut.Project.description,
      },
      role: ut.role,
      note: ut.note,
    }));

    res.json(projects);
  } catch (err) {
    console.error("Get user projects error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      targetUserId: req.params.userId,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to fetch user projects", details: err.message });
  }
};
