const db = require("../models");
const { sendMail } = require("../utils/mailer");

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

    const [team] = await db.sequelize.query(
      `
      INSERT INTO Teams (name, description, createdAt, updatedAt)
      VALUES (:name, :description, NOW(), NOW())
      RETURNING id, name, description, createdAt, updatedAt;
      `,
      {
        replacements: { name, description: description || null },
        type: db.sequelize.QueryTypes.INSERT,
      }
    );

    res.status(201).json({ message: "Team created", team });
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
      .json({ error: "Failed to create team", details: err.message });
  }
};

exports.getAllTeams = async (req, res) => {
  try {
    const { search } = req.query;
    let query = `
      SELECT t.id, t.name, t.description, t.createdAt, t.updatedAt
      FROM Teams t
    `;
    const replacements = {};

    if (search) {
      query += ` WHERE t.name LIKE :search`;
      replacements.search = `%${search}%`;
    }

    const teams = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    const formattedTeams = await Promise.all(
      teams.map(async (team) => {
        const users = await db.sequelize.query(
          `
          SELECT u.id, u.firstName, u.lastName, u.email, ut.role, ut.note, ut.projectId
          FROM Users u
          INNER JOIN UserTeams ut ON u.id = ut.userId
          WHERE ut.teamId = :teamId
          `,
          {
            replacements: { teamId: team.id },
            type: db.sequelize.QueryTypes.SELECT,
          }
        );
        return {
          ...team,
          Users: users,
        };
      })
    );

    res.json(formattedTeams);
  } catch (err) {
    console.error("Get teams error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
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

    const [team] = await db.sequelize.query(
      `SELECT id, name, description, createdAt, updatedAt FROM Teams WHERE id = :id`,
      {
        replacements: { id },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    const users = await db.sequelize.query(
      `
      SELECT u.id, u.firstName, u.lastName, u.email, ut.role, ut.note, ut.projectId
      FROM Users u
      INNER JOIN UserTeams ut ON u.id = ut.userId
      WHERE ut.teamId = :teamId
      `,
      {
        replacements: { teamId: id },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    const projects = await db.sequelize.query(
      `SELECT id, name FROM Projects WHERE teamId = :teamId`,
      {
        replacements: { teamId: id },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    res.json({
      ...team,
      Users: users,
      Projects: projects,
    });
  } catch (err) {
    console.error("Get team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      params: req.params,
      timestamp: new Date().toISOString(),
    });
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

    const [team] = await db.sequelize.query(
      `SELECT id, name FROM Teams WHERE id = :id`,
      {
        replacements: { id },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    const updates = [];
    const replacements = { id };
    if (name) {
      updates.push(`name = :name`);
      replacements.name = name;
    }
    if (description !== undefined) {
      updates.push(`description = :description`);
      replacements.description = description || null;
    }

    if (updates.length > 0) {
      await db.sequelize.query(
        `
        UPDATE Teams
        SET ${updates.join(", ")}, updatedAt = NOW()
        WHERE id = :id
        `,
        {
          replacements,
          type: db.sequelize.QueryTypes.UPDATE,
        }
      );
    }

    if (users && Array.isArray(users)) {
      const transaction = await db.sequelize.transaction();
      try {
        for (const user of users) {
          const { id: userId, role, note, projectId } = user;
          if (!userId) {
            console.warn("Skipping user with missing userId", {
              user,
              teamId: id,
            });
            continue;
          }

          const [userDetails] = await db.sequelize.query(
            `SELECT id FROM Users WHERE id = :userId`,
            {
              replacements: { userId },
              type: db.sequelize.QueryTypes.SELECT,
              transaction,
            }
          );
          if (!userDetails) {
            console.warn("User not found", { userId, teamId: id });
            continue;
          }

          const [existing] = await db.sequelize.query(
            `
            SELECT * FROM UserTeams
            WHERE userId = :userId AND teamId = :teamId AND projectId IS NULL
            `,
            {
              replacements: { userId, teamId: id, projectId: projectId || null },
              type: db.sequelize.QueryTypes.SELECT,
              transaction,
            }
          );

          if (existing) {
            await db.sequelize.query(
              `
              UPDATE UserTeams
              SET role = :role, note = :note, projectId = :projectId, updatedAt = NOW()
              WHERE userId = :userId AND teamId = :teamId AND projectId IS NULL
              `,
              {
                replacements: {
                  userId,
                  teamId: id,
                  role: role || "Member",
                  note: note || null,
                  projectId: projectId || null,
                },
                type: db.sequelize.QueryTypes.UPDATE,
                transaction,
              }
            );
          } else {
            await db.sequelize.query(
              `
              INSERT INTO UserTeams (userId, teamId, projectId, role, note, createdAt, updatedAt)
              VALUES (:userId, :teamId, :projectId, :role, :note, NOW(), NOW())
              `,
              {
                replacements: {
                  userId,
                  teamId: id,
                  projectId: projectId || null,
                  role: role || "Member",
                  note: note || null,
                },
                type: db.sequelize.QueryTypes.INSERT,
                transaction,
              }
            );
          }
        }
        await transaction.commit();
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    }

    const [updatedTeam] = await db.sequelize.query(
      `SELECT id, name, description, createdAt, updatedAt FROM Teams WHERE id = :id`,
      {
        replacements: { id },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    const usersData = await db.sequelize.query(
      `
      SELECT u.id, u.firstName, u.lastName, u.email, ut.role, ut.note, ut.projectId
      FROM Users u
      INNER JOIN UserTeams ut ON u.id = ut.userId
      WHERE ut.teamId = :teamId
      `,
      {
        replacements: { teamId: id },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    const projects = await db.sequelize.query(
      `SELECT id, name FROM Projects WHERE teamId = :teamId`,
      {
        replacements: { teamId: id },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    res.json({
      message: "Team updated",
      team: { ...updatedTeam, Users: usersData, Projects: projects },
    });
  } catch (err) {
    console.error("Update team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      params: req.params,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
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

    const [team] = await db.sequelize.query(
      `SELECT id FROM Teams WHERE id = :id`,
      {
        replacements: { id },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    await db.sequelize.query(
      `DELETE FROM UserTeams WHERE teamId = :teamId`,
      {
        replacements: { teamId: id },
        type: db.sequelize.QueryTypes.DELETE,
      }
    );

    await db.sequelize.query(
      `UPDATE Users SET teamId = NULL WHERE teamId = :teamId`,
      {
        replacements: { teamId: id },
        type: db.sequelize.QueryTypes.UPDATE,
      }
    );

    await db.sequelize.query(
      `DELETE FROM Teams WHERE id = :id`,
      {
        replacements: { id },
        type: db.sequelize.QueryTypes.DELETE,
      }
    );

    res.json({ message: "Team deleted" });
  } catch (err) {
    console.error("Delete team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      params: req.params,
      timestamp: new Date().toISOString(),
    });
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

    const transaction = await db.sequelize.transaction();
    try {
      const [team] = await db.sequelize.query(
        `SELECT id, name, description FROM Teams WHERE id = :teamId`,
        {
          replacements: { teamId },
          type: db.sequelize.QueryTypes.SELECT,
          transaction,
        }
      );
      if (!team) {
        await transaction.rollback();
        return res.status(404).json({ error: "Team not found" });
      }

      const [currentUser] = await db.sequelize.query(
        `SELECT id, firstName, lastName FROM Users WHERE id = :userId`,
        {
          replacements: { userId: req.user.id },
          type: db.sequelize.QueryTypes.SELECT,
          transaction,
        }
      );
      if (!currentUser) {
        await transaction.rollback();
        return res.status(404).json({ error: "Current user not found" });
      }

      const results = [];
      for (const user of users) {
        const { id: userId, role, note, projectId } = user;
        if (!userId) {
          console.warn("Skipping user with missing userId", {
            user,
            teamId,
            timestamp: new Date().toISOString(),
          });
          results.push({ userId: null, status: "skipped", reason: "Missing userId" });
          continue;
        }

        const [userDetails] = await db.sequelize.query(
          `SELECT id, email, firstName, lastName FROM Users WHERE id = :userId`,
          {
            replacements: { userId },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          }
        );
        if (!userDetails) {
          console.warn("User not found", {
            userId,
            teamId,
            timestamp: new Date().toISOString(),
          });
          results.push({ userId, status: "failed", reason: "User not found" });
          continue;
        }

        if (!userDetails.email) {
          console.warn("User email missing", {
            userId,
            teamId,
            timestamp: new Date().toISOString(),
          });
          results.push({ userId, status: "skipped", reason: "Missing email" });
          continue;
        }

        const [existing] = await db.sequelize.query(
          `
          SELECT * FROM UserTeams
          WHERE userId = :userId AND teamId = :teamId AND projectId IS NULL
          `,
          {
            replacements: { userId, teamId, projectId: projectId || null },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          }
        );

        if (existing) {
          console.warn("User already assigned to team", {
            userId,
            teamId,
            projectId,
            timestamp: new Date().toISOString(),
          });
          results.push({ userId, status: "skipped", reason: "Already assigned" });
          continue;
        }

        await db.sequelize.query(
          `
          INSERT INTO UserTeams (userId, teamId, projectId, role, note, createdAt, updatedAt)
          VALUES (:userId, :teamId, :projectId, :role, :note, NOW(), NOW())
          `,
          {
            replacements: {
              userId,
              teamId,
              projectId: projectId || null,
              role: role || "Member",
              note: note || null,
            },
            type: db.sequelize.QueryTypes.INSERT,
            transaction,
          }
        );

        await sendMail({
          to: userDetails.email,
          subject: `You’ve been added to the ${team.name} team`,
          html: `
            <p>Hello ${userDetails.firstName},</p>
            <p>You’ve been added to the <strong>${team.name}</strong> team by ${currentUser.firstName} ${currentUser.lastName}.</p>
            <p>Role: ${role || "Member"}</p>
            <p>Note: ${note || "N/A"}</p>
            <p>Project: ${projectId ? `ID ${projectId}` : "N/A"}</p>
            <p>Description: ${team.description || "N/A"}</p>
          `,
        });

        results.push({ userId, status: "success" });
      }

      await transaction.commit();

      const [updatedTeam] = await db.sequelize.query(
        `SELECT id, name, description, createdAt, updatedAt FROM Teams WHERE id = :teamId`,
        {
          replacements: { teamId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      const usersData = await db.sequelize.query(
        `
        SELECT u.id, u.firstName, u.lastName, u.email, ut.role, ut.note, ut.projectId
        FROM Users u
        INNER JOIN UserTeams ut ON u.id = ut.userId
        WHERE ut.teamId = :teamId
        `,
        {
          replacements: { teamId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      const projects = await db.sequelize.query(
        `SELECT id, name FROM Projects WHERE teamId = :teamId`,
        {
          replacements: { teamId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      res.status(200).json({
        message: "Users assigned to team",
        team: { ...updatedTeam, Users: usersData, Projects: projects },
        userCount: users.length,
        results,
      });
    } catch (err) {
      await transaction.rollback();
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
        .json({ error: "Failed to assign users to team", details: err.message });
    }
  }
};
