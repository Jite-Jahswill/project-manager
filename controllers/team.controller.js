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
    res.status(201).json({ message: "Team created", team });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to create team", details: err.message });
  }
};

exports.getAllTeams = async (req, res) => {
  try {
    const { search } = req.query;
    const whereClause = {};

    if (search) {
      whereClause.name = { [Op.like]: `%${search}%` };
    }

    const teams = await Team.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          through: {
            attributes: ["role", "note"],
            where: { projectId: null }, // Exclude projectId to avoid join issues
          },
        },
      ],
    });

    res.json(teams);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch teams", details: err.message });
  }
};

exports.getTeamById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }

    const team = await Team.findByPk(id, {
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          through: {
            attributes: ["role", "note"],
            where: { projectId: null },
          },
        },
        {
          model: Project,
          attributes: ["id", "name"],
        },
      ],
    });

    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    res.json(team);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch team", details: err.message });
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
      return res.status(404).json({ error: "Team not found" });
    }

    await team.update({
      name: name || team.name,
      description: description || team.description,
    });

    if (users && Array.isArray(users)) {
      for (const user of users) {
        const { id: userId, role, note, projectId } = user;
        if (!userId) {
          console.warn("Skipping user with missing userId", {
            user,
            teamId: team.id,
          });
          continue;
        }

        const userTeamEntry = await UserTeam.findOne({
          where: { userId, teamId: team.id, projectId: projectId || null },
        });

        if (userTeamEntry) {
          await userTeamEntry.update({
            role: role || userTeamEntry.role,
            note: note || userTeamEntry.note,
            projectId: projectId || userTeamEntry.projectId,
          });
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

    res.json({ message: "Team updated", team: updatedTeam });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to update team", details: err.message });
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
      return res.status(400).json({ error: "id is required" });
    }

    const team = await Team.findByPk(id);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    await UserTeam.destroy({ where: { teamId: team.id } });
    await User.update({ teamId: null }, { where: { teamId: team.id } });
    await team.destroy();

    res.json({ message: "Team deleted" });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to delete team", details: err.message });
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
      return res.status(404).json({ error: "Team not found" });
    }

    const currentUser = await User.findByPk(req.user.id, {
      attributes: ["firstName", "lastName"],
    });
    if (!currentUser) {
      return res.status(404).json({ error: "Current user not found" });
    }

    for (const user of users) {
      const { id: userId, role, note, projectId } = user;
      if (!userId) {
        console.warn("Skipping user with missing userId", { user, teamId });
        continue;
      }

      const userDetails = await User.findByPk(userId, {
        attributes: ["id", "email", "firstName", "lastName"],
      });
      if (!userDetails) {
        console.warn("User not found", { userId, teamId });
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

      await sendMail(
        userDetails.email,
        `You’ve been added to the ${team.name} team`,
        `<p>Hello ${userDetails.firstName},</p>
         <p>You’ve been added to the <strong>${team.name}</strong> team by ${
          currentUser.firstName
        } ${currentUser.lastName}.</p>
         <p>Role: ${role || "Member"}</p>
         <p>Note: ${note || "N/A"}</p>
         <p>Project: ${projectId ? `ID ${projectId}` : "N/A"}</p>
         <p>Description: ${team.description || "N/A"}</p>`
      );
    }

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
      message: "Users assigned to team",
      team: updatedTeam,
      userCount: users.length,
    });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to assign users to team", details: err.message });
  }
};
