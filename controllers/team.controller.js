const { Team, User, UserTeam, Project } = require("../models");
const { Op } = require("sequelize");
const sendMail = require("../utils/mailer");

exports.createTeam = async (req, res) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can create teams" });
    }

    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ message: "name is required" });
    }

    const team = await Team.create({ name, description });
    res.status(201).json({ message: "Team created successfully", team });
  } catch (err) {
    console.error("Create team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Failed to create team", details: err.message });
  }
};

exports.getAllTeams = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const whereClause = {};

    if (search) {
      whereClause.name = { [Op.like]: `%${search}%` };
    }

    // Restrict staff to teams they are part of
    let userTeamWhere = { projectId: null }; // Exclude projectId to avoid join issues
    if (req.user.role === "staff") {
      userTeamWhere.userId = req.user.id;
    }

    const { count, rows } = await Team.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          through: {
            attributes: ["role", "note"],
            where: userTeamWhere,
          },
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit),
    });

    const totalPages = Math.ceil(count / limit);

    res.status(200).json({
      teams: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Get all teams error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Failed to fetch teams", details: err.message });
  }
};

exports.getTeamById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "id is required" });
    }

    const team = await Team.findByPk(id, {
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          through: {
            attributes: ["role", "note"],
            where: req.user.role === "staff" ? { userId: req.user.id, projectId: null } : { projectId: null },
          },
        },
        {
          model: Project,
          attributes: ["id", "name"],
        },
      ],
    });

    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    if (req.user.role === "staff" && !team.Users.some(user => user.id === req.user.id)) {
      return res.status(403).json({ message: "Unauthorized to view this team" });
    }

    res.status(200).json(team);
  } catch (err) {
    console.error("Get team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      teamId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Failed to fetch team", details: err.message });
  }
};

exports.updateTeam = async (req, res) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can update teams" });
    }

    const { id } = req.params;
    const { name, description, users } = req.body;
    if (!id) {
      return res.status(400).json({ message: "id is required" });
    }

    const team = await Team.findByPk(id);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    // Update team details
    await db.sequelize.query(
      "UPDATE Teams SET name = :name, description = :description WHERE id = :id",
      {
        replacements: {
          name: name || team.name,
          description: description || team.description,
          id,
        },
        type: db.sequelize.QueryTypes.UPDATE,
      }
    );

    // Update user assignments
    if (users && Array.isArray(users)) {
      for (const user of users) {
        const { id: userId, role, note, projectId } = user;
        if (!userId) {
          console.warn("Skipping user with missing userId", {
            user,
            teamId: team.id,
            userId: req.user.id,
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        const userTeamEntry = await UserTeam.findOne({
          where: { userId, teamId: team.id, projectId: projectId || null },
        });

        if (userTeamEntry) {
          await db.sequelize.query(
            "UPDATE UserTeam SET role = :role, note = :note, projectId = :projectId WHERE userId = :userId AND teamId = :teamId AND projectId IS :projectId",
            {
              replacements: {
                role: role || userTeamEntry.role,
                note: note || userTeamEntry.note,
                projectId: projectId || userTeamEntry.projectId,
                userId,
                teamId: team.id,
              },
              type: db.sequelize.QueryTypes.UPDATE,
            }
          );
        } else {
          await UserTeam.create({
            userId,
            teamId: team.id,
            projectId: projectId || null,
            role: role || "Member",
            note: note || null,
          });
        }
      }
    }

    // Fetch updated team
    const updatedTeam = await Team.findByPk(id, {
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          through: {
            attributes: ["role", "note", "projectId"],
          },
        },
        {
          model: Project,
          attributes: ["id", "name"],
        },
      ],
    });

    res.status(200).json({ message: "Team updated successfully", team: updatedTeam });
  } catch (err) {
    console.error("Update team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      teamId: req.params.id,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Failed to update team", details: err.message });
  }
};

exports.deleteTeam = async (req, res) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can delete teams" });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "id is required" });
    }

    const team = await Team.findByPk(id);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    await UserTeam.destroy({ where: { teamId: team.id } });
    await team.destroy();

    res.status(200).json({ message: "Team deleted successfully" });
  } catch (err) {
    console.error("Delete team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      teamId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Failed to delete team", details: err.message });
  }
};

exports.assignUsersToTeam = async (req, res) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can assign users to teams" });
    }

    const { teamId, users } = req.body;
    if (!teamId || !users || !Array.isArray(users)) {
      return res
        .status(400)
        .json({ message: "teamId and users array are required" });
    }

    const team = await Team.findByPk(teamId);
    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    const currentUser = await User.findByPk(req.user.id, {
      attributes: ["firstName", "lastName"],
    });
    if (!currentUser) {
      return res.status(404).json({ message: "Current user not found" });
    }

    const emailPromises = [];
    const validUsers = [];

    for (const user of users) {
      const { id: userId, role, note, projectId } = user;
      if (!userId) {
        console.warn("Skipping user with missing userId", {
          user,
          teamId,
          userId: req.user.id,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const userDetails = await User.findByPk(userId, {
        attributes: ["id", "email", "firstName", "lastName"],
      });
      if (!userDetails) {
        console.warn("User not found", {
          userId,
          teamId,
          userId: req.user.id,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const existing = await UserTeam.findOne({
        where: { userId, teamId, projectId: projectId || null },
      });
      if (existing) {
        console.warn("User already assigned to team", {
          userId,
          teamId,
          projectId,
          userId: req.user.id,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      await UserTeam.create({
        userId,
        teamId,
        projectId: projectId || null,
        role: role || "Member",
        note: note || null,
      });

      validUsers.push(userDetails);

      emailPromises.push(
        sendMail({
          to: userDetails.email,
          subject: `You’ve been added to the ${team.name} team`,
          html: `
            <p>Hello ${userDetails.firstName},</p>
            <p>You’ve been added to the <strong>${team.name}</strong> team by ${
              currentUser.firstName
            } ${currentUser.lastName}.</p>
            <p>Role: ${role || "Member"}</p>
            <p>Note: ${note || "N/A"}</p>
            <p>Project: ${projectId ? `ID ${projectId}` : "N/A"}</p>
            <p>Description: ${team.description || "N/A"}</p>
          `,
        })
      );
    }

    await Promise.all(emailPromises);

    const updatedTeam = await Team.findByPk(teamId, {
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          through: {
            attributes: ["role", "note", "projectId"],
          },
        },
        {
          model: Project,
          attributes: ["id", "name"],
        },
      ],
    });

    res.status(200).json({
      message: "Users assigned to team successfully",
      team: updatedTeam,
      userCount: validUsers.length,
    });
  } catch (err) {
    console.error("Assign users to team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Failed to assign users to team", details: err.message });
  }
};
