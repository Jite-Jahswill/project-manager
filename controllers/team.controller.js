const db = require("../models");
const sendMail = require("../utils/mailer");

exports.createTeam = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      await transaction.rollback();
      return res
        .status(403)
        .json({ message: "Only admins or managers can create teams" });
    }

    const { name, description } = req.body;
    if (!name) {
      await transaction.rollback();
      return res.status(400).json({ message: "name is required" });
    }

    // Create team using Sequelize
    const team = await db.Team.create(
      {
        name,
        description: description || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { transaction }
    );

    await transaction.commit();
    res.status(201).json({
      message: "Team created",
      team: {
        teamId: team.id,
        teamName: team.name,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      },
    });
  } catch (err) {
    await transaction.rollback();
    console.error("Create team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    if (err.message.includes("prepare statement needs to be reprepared")) {
      return res.status(500).json({
        message: "Database connection issue occurred",
        details: "Please try again or contact support if the issue persists",
      });
    }
    res
      .status(500)
      .json({ error: "Failed to create team", details: err.message });
  }
};

exports.getAllTeams = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;

    // Validate page and limit
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: "Invalid page or limit" });
    }

    // Build query for teams
    let query = `
      SELECT id, name, createdAt, updatedAt
      FROM Teams
    `;
    const replacements = {};

    let whereClauses = [];
    if (search) {
      whereClauses.push(`name LIKE :search`);
      replacements.search = `%${search}%`;
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(" AND ")}`;
    }

    // Add pagination
    const offset = (pageNum - 1) * limitNum;
    query += ` LIMIT :limit OFFSET :offset`;
    replacements.limit = limitNum;
    replacements.offset = offset;

    // Fetch teams
    const teams = await db.sequelize.query(query, {
      replacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Fetch total count for pagination
    let countQuery = `SELECT COUNT(*) as total FROM Teams`;
    const countReplacements = {};
    if (whereClauses.length > 0) {
      countQuery += ` WHERE ${whereClauses.join(" AND ")}`;
      Object.assign(countReplacements, replacements);
    }

    const [{ total }] = await db.sequelize.query(countQuery, {
      replacements: countReplacements,
      type: db.sequelize.QueryTypes.SELECT,
    });

    // Fetch users, projects, and tasks for each team
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

        const projects = await db.sequelize.query(
          `
          SELECT id, name
          FROM Projects
          WHERE teamId = :teamId
          `,
          {
            replacements: { teamId: team.id },
            type: db.sequelize.QueryTypes.SELECT,
          }
        );

        const tasks = projects.length
          ? await db.sequelize.query(
              `
              SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId,
                     u.id AS userId, u.firstName, u.lastName, u.email
              FROM Tasks t
              LEFT JOIN Users u ON t.assignedTo = u.id
              WHERE t.projectId IN (:projectIds)
              `,
              {
                replacements: { projectIds: projects.map((p) => p.id) },
                type: db.sequelize.QueryTypes.SELECT,
              }
            )
          : [];

        return {
          teamId: team.id,
          teamName: team.name,
          createdAt: team.createdAt,
          updatedAt: team.updatedAt,
          users: users.map((user) => ({
            userId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            note: user.note,
            projectId: user.projectId,
          })),
          projects: projects.map((project) => ({
            id: project.id,
            name: project.name,
            tasks: tasks
              .filter((task) => task.projectId === project.id)
              .map((task) => ({
                id: task.id,
                title: task.title,
                description: task.description,
                status: task.status,
                dueDate: task.dueDate,
                assignee: task.userId
                  ? {
                      userId: task.userId,
                      firstName: task.firstName,
                      lastName: task.lastName,
                      email: task.email,
                    }
                  : null,
              })),
          })),
        };
      })
    );

    // Pagination metadata
    const pagination = {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      totalItems: parseInt(total, 10),
      itemsPerPage: limitNum,
    };

    res.json({ teams: formattedTeams, pagination });
  } catch (err) {
    console.error("Get teams error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    if (err.message.includes("prepare statement needs to be reprepared")) {
      return res.status(500).json({
        message: "Database connection issue occurred",
        details: "Please try again or contact support if the issue persists",
      });
    }
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
      `SELECT id, name, createdAt, updatedAt FROM Teams WHERE id = :id`,
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

    const tasks = projects.length
      ? await db.sequelize.query(
          `
          SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId,
                 u.id AS userId, u.firstName, u.lastName, u.email
          FROM Tasks t
          LEFT JOIN Users u ON t.assignedTo = u.id
          WHERE t.projectId IN (:projectIds)
          `,
          {
            replacements: { projectIds: projects.map((p) => p.id) },
            type: db.sequelize.QueryTypes.SELECT,
          }
        )
      : [];

    res.json({
      teamId: team.id,
      teamName: team.name,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      users: users.map((user) => ({
        userId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        note: user.note,
        projectId: user.projectId,
      })),
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        tasks: tasks
          .filter((task) => task.projectId === project.id)
          .map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            dueDate: task.dueDate,
            assignee: task.userId
              ? {
                  userId: task.userId,
                  firstName: task.firstName,
                  lastName: task.lastName,
                  email: task.email,
                }
              : null,
          })),
      })),
    });
  } catch (err) {
    console.error("Get team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      params: req.params,
      timestamp: new Date().toISOString(),
    });
    if (err.message.includes("prepare statement needs to be reprepared")) {
      return res.status(500).json({
        message: "Database connection issue occurred",
        details: "Please try again or contact support if the issue persists",
      });
    }
    res
      .status(500)
      .json({ error: "Failed to fetch team", details: err.message });
  }
};

exports.updateTeam = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      await transaction.rollback();
      return res
        .status(403)
        .json({ message: "Only admins or managers can update teams" });
    }

    const { id } = req.params;
    const { name, description, users } = req.body;
    if (!id) {
      await transaction.rollback();
      return res.status(400).json({ message: "id is required" });
    }

    const [team] = await db.sequelize.query(
      `SELECT id, name FROM Teams WHERE id = :id`,
      {
        replacements: { id },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      }
    );
    if (!team) {
      await transaction.rollback();
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
          transaction,
        }
      );
    }

    if (users && Array.isArray(users)) {
      for (const user of users) {
        const { id: userId, role, note, projectId } = user;
        if (!userId) {
          console.warn("Skipping user with missing userId", {
            user,
            teamId: id,
            timestamp: new Date().toISOString(),
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
          console.warn("User not found", { userId, teamId: id, timestamp: new Date().toISOString() });
          continue;
        }

        if (projectId) {
          const [project] = await db.sequelize.query(
            `SELECT id FROM Projects WHERE id = :projectId`,
            {
              replacements: { teamId: id, projectId },
              type: db.sequelize.QueryTypes.SELECT,
              transaction,
            }
          );
          if (!project) {
            console.warn("Project not found", { projectId, teamId: id, timestamp: new Date().toISOString() });
            continue;
          }
        }

        const [existing] = await db.sequelize.query(
          `
          SELECT * FROM UserTeams
          WHERE userId = :userId AND teamId = :teamId AND (projectId = :projectId OR (projectId IS NULL AND :projectId IS NULL))
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
            WHERE userId = :userId AND teamId = :teamId AND (projectId = :projectId OR (projectId IS NULL AND :projectId IS NULL))
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
          await db.UserTeam.create(
            {
              userId,
              teamId: id,
              projectId: projectId || null,
              role: role || "Member",
              note: note || null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            { transaction }
          );
        }
      }
    }

    const [updatedTeam] = await db.sequelize.query(
      `SELECT id, name, createdAt, updatedAt FROM Teams WHERE id = :id`,
      {
        replacements: { id },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
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
        transaction,
      }
    );

    const projects = await db.sequelize.query(
      `SELECT id, name FROM Projects WHERE teamId = :teamId`,
      {
        replacements: { teamId: id },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      }
    );

    const tasks = projects.length
      ? await db.sequelize.query(
          `
          SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId,
                 u.id AS userId, u.firstName, u.lastName, u.email
          FROM Tasks t
          LEFT JOIN Users u ON t.assignedTo = u.id
          WHERE t.projectId IN (:projectIds)
          `,
          {
            replacements: { projectIds: projects.map((p) => p.id) },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          }
        )
      : [];

    await transaction.commit();
    res.json({
      message: "Team updated",
      team: {
        teamId: updatedTeam.id,
        teamName: updatedTeam.name,
        createdAt: updatedTeam.createdAt,
        updatedAt: updatedTeam.updatedAt,
        users: usersData.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          note: user.note,
          projectId: user.projectId,
        })),
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          tasks: tasks
            .filter((task) => task.projectId === project.id)
            .map((task) => ({
              id: task.id,
              title: task.title,
              description: task.description,
              status: task.status,
              dueDate: task.dueDate,
              assignee: task.userId
                ? {
                    userId: task.userId,
                    firstName: task.firstName,
                    lastName: task.lastName,
                    email: task.email,
                  }
                : null,
            })),
        })),
      },
    });
  } catch (err) {
    await transaction.rollback();
    console.error("Update team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      params: req.params,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    if (err.message.includes("prepare statement needs to be reprepared")) {
      return res.status(500).json({
        message: "Database connection issue occurred",
        details: "Please try again or contact support if the issue persists",
      });
    }
    res
      .status(500)
      .json({ error: "Failed to update team", details: err.message });
  }
};

exports.deleteTeam = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      await transaction.rollback();
      return res
        .status(403)
        .json({ message: "Only admins or managers can delete teams" });
    }

    const { id } = req.params;
    if (!id) {
      await transaction.rollback();
      return res.status(400).json({ error: "id is required" });
    }

    const [team] = await db.sequelize.query(
      `SELECT id FROM Teams WHERE id = :id`,
      {
        replacements: { id },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      }
    );
    if (!team) {
      await transaction.rollback();
      return res.status(404).json({ error: "Team not found" });
    }

    // Delete UserTeams associations
    await db.UserTeam.destroy({ where: { teamId: id }, transaction });

    // Update Users to remove teamId
    await db.sequelize.query(
      `UPDATE Users SET teamId = NULL, updatedAt = NOW() WHERE teamId = :teamId`,
      {
        replacements: { teamId: id },
        type: db.sequelize.QueryTypes.UPDATE,
        transaction,
      }
    );

    // Delete Team
    await db.Team.destroy({ where: { id }, transaction });

    await transaction.commit();
    res.json({ message: "Team deleted" });
  } catch (err) {
    await transaction.rollback();
    console.error("Delete team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      params: req.params,
      timestamp: new Date().toISOString(),
    });
    if (err.message.includes("prepare statement needs to be reprepared")) {
      return res.status(500).json({
        message: "Database connection issue occurred",
        details: "Please try again or contact support if the issue persists",
      });
    }
    res
      .status(500)
      .json({ error: "Failed to delete team", details: err.message });
  }
};

exports.assignUsersToTeam = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      await transaction.rollback();
      return res
        .status(403)
        .json({ message: "Only admins or managers can assign users to teams" });
    }

    const { teamId, users } = req.body;
    if (!teamId || !users || !Array.isArray(users)) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ message: "teamId and users array are required" });
    }

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
        results.push({ userId, status: "failed", reason: "User ID not found" });
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
        WHERE userId = :userId AND teamId = :teamId AND (projectId = :projectId OR (projectId IS NULL AND :projectId IS NULL))
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

      await db.UserTeam.create(
        {
          userId,
          teamId,
          projectId: projectId || null,
          role: role || "Member",
          note: note || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { transaction }
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

    const [updatedTeam] = await db.sequelize.query(
      `SELECT id, name, createdAt, updatedAt FROM Teams WHERE id = :teamId`,
      {
        replacements: { teamId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
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
        transaction,
      }
    );

    const projects = await db.sequelize.query(
      `SELECT id, name FROM Projects WHERE teamId = :teamId`,
      {
        replacements: { teamId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      }
    );

    const tasks = projects.length
      ? await db.sequelize.query(
          `
          SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId,
                 u.id AS userId, u.firstName, u.lastName, u.email
          FROM Tasks t
          LEFT JOIN Users u ON t.assignedTo = u.id
          WHERE t.projectId IN (:projectIds)
          `,
          {
            replacements: { projectIds: projects.map((p) => p.id) },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          }
        )
      : [];

    await transaction.commit();
    res.status(200).json({
      message: "Users assigned to team",
      team: {
        teamId: updatedTeam.id,
        teamName: updatedTeam.name,
        createdAt: updatedTeam.createdAt,
        updatedAt: updatedTeam.updatedAt,
        users: usersData.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          note: user.note,
          projectId: user.projectId,
        })),
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          tasks: tasks
            .filter((task) => task.projectId === project.id)
            .map((task) => ({
              id: task.id,
              title: task.title,
              description: task.description,
              status: task.status,
              dueDate: task.dueDate,
              assignee: task.userId
                ? {
                    userId: task.userId,
                    firstName: task.firstName,
                    lastName: task.lastName,
                    email: task.email,
                  }
                : null,
            })),
        })),
      },
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
    if (err.message.includes("prepare statement needs to be reprepared")) {
      return res.status(500).json({
        message: "Database connection issue occurred",
        details: "Please try again or contact support if the issue persists",
      });
    }
    res
      .status(500)
      .json({ error: "Failed to assign users to team", details: err.message });
  }
};

exports.unassignUsersFromTeam = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      await transaction.rollback();
      return res
        .status(403)
        .json({ message: "Only admins or managers can unassign users from teams" });
    }

    const { teamId, userIds } = req.body;
    if (!teamId || !userIds || !Array.isArray(userIds)) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ message: "teamId and userIds array are required" });
    }

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
    for (const userId of userIds) {
      if (!userId) {
        console.warn("Skipping user with missing userId", {
          userId,
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
        results.push({ userId, status: "failed", reason: "User ID not found" });
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
        WHERE userId = :userId AND teamId = :teamId
        `,
        {
          replacements: { userId, teamId },
          type: db.sequelize.QueryTypes.SELECT,
          transaction,
        }
      );

      if (!existing) {
        console.warn("User not assigned to team", {
          userId,
          teamId,
          timestamp: new Date().toISOString(),
        });
        results.push({ userId, status: "skipped", reason: "Not assigned" });
        continue;
      }

      await db.UserTeam.destroy(
        {
          where: { userId, teamId },
        },
        { transaction }
      );

      await sendMail({
        to: userDetails.email,
        subject: `You’ve been removed from the ${team.name} team`,
        html: `
          <p>Hello ${userDetails.firstName},</p>
          <p>You’ve been removed from the <strong>${team.name}</strong> team by ${currentUser.firstName} ${currentUser.lastName}.</p>
          <p>Description: ${team.description || "N/A"}</p>
        `,
      });

      results.push({ userId, status: "success" });
    }

    const [updatedTeam] = await db.sequelize.query(
      `SELECT id, name, createdAt, updatedAt FROM Teams WHERE id = :teamId`,
      {
        replacements: { teamId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
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
        transaction,
      }
    );

    const projects = await db.sequelize.query(
      `SELECT id, name FROM Projects WHERE teamId = :teamId`,
      {
        replacements: { teamId },
        type: db.sequelize.QueryTypes.SELECT,
        transaction,
      }
    );

    const tasks = projects.length
      ? await db.sequelize.query(
          `
          SELECT t.id, t.title, t.description, t.status, t.dueDate, t.projectId,
                 u.id AS userId, u.firstName, u.lastName, u.email
          FROM Tasks t
          LEFT JOIN Users u ON t.assignedTo = u.id
          WHERE t.projectId IN (:projectIds)
          `,
          {
            replacements: { projectIds: projects.map((p) => p.id) },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          }
        )
      : [];

    await transaction.commit();
    res.status(200).json({
      message: "Users unassigned from team",
      team: {
        teamId: updatedTeam.id,
        teamName: updatedTeam.name,
        createdAt: updatedTeam.createdAt,
        updatedAt: updatedTeam.updatedAt,
        users: usersData.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          note: user.note,
          projectId: user.projectId,
        })),
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          tasks: tasks
            .filter((task) => task.projectId === project.id)
            .map((task) => ({
              id: task.id,
              title: task.title,
              description: task.description,
              status: task.status,
              dueDate: task.dueDate,
              assignee: task.userId
                ? {
                    userId: task.userId,
                    firstName: task.firstName,
                    lastName: task.lastName,
                    email: task.email,
                  }
                : null,
            })),
        })),
      },
      userCount: userIds.length,
      results,
    });
  } catch (err) {
    await transaction.rollback();
    console.error("Unassign users from team error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    if (err.message.includes("prepare statement needs to be reprepared")) {
      return res.status(500).json({
        message: "Database connection issue occurred",
        details: "Please try again or contact support if the issue persists",
      });
    }
    res
      .status(500)
      .json({ error: "Failed to unassign users from team", details: err.message });
  }
};
