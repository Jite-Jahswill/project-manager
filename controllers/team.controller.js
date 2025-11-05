const db = require("../models");
const sendMail = require("../utils/mailer");

module.exports = {
  // Create a new team
  async createTeam(req, res) {
    try {
      const { name, description } = req.body;

      // Validate input
      if (!name) {
        return res.status(400).json({ message: "name is required" });
      }

      // Create team using Sequelize
      const team = await db.Team.create({
        name,
        description: description || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Fetch team with users and projects
      const formattedTeam = await db.Team.findByPk(team.id, {
        include: [
          { model: db.User, as: "Users", through: { attributes: ["role", "note", "projectId"] } },
          { model: db.Project, as: "Projects", include: [{ model: db.Task, as: "Tasks", include: [{ model: db.User, as: "assignee" }] }] },
        ],
      });

      // Format response
      const teamResponse = {
        teamId: formattedTeam.id,
        teamName: formattedTeam.name,
        description: formattedTeam.description,
        createdAt: formattedTeam.createdAt,
        updatedAt: formattedTeam.updatedAt,
        users: formattedTeam.Users.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.UserTeam.role,
          note: user.UserTeam.note,
          projectId: user.UserTeam.projectId,
        })),
        projects: formattedTeam.Projects.map((project) => ({
          id: project.id,
          name: project.name,
          tasks: project.Tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            dueDate: task.dueDate,
            assignee: task.assignee
              ? { userId: task.assignee.id, firstName: task.assignee.firstName, lastName: task.assignee.lastName, email: task.assignee.email }
              : null,
          })),
        })),
      };

      // Notify users
      const users = await db.User.findAll({
        attributes: ["email"],
      });
      const emails = users.map((u) => u.email).filter(Boolean);

      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: "🆕 New Team Created",
          html: `
            <p>Hello,</p>
            <p>A new team <strong>${team.name}</strong> has been created by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
            <p><strong>Description:</strong> ${team.description || "No description"}</p>
            <p>Best,<br>Team</p>
          `,
        });
      } else {
        console.warn("No emails found for notification", {
          userId: req.user.id,
          teamId: team.id,
          timestamp: new Date().toISOString(),
        });
      }

      res.status(201).json({ message: "Team created", team: teamResponse });
    } catch (err) {
      console.error("Create team error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ error: "Failed to create team", details: err.message });
    }
  },

  // Get all teams
  async getAllTeams(req, res) {
    try {
      const { search, page = 1, limit = 20 } = req.query;
      // Validate pagination
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: "Invalid page or limit" });
      }

      // Build where clause
      const whereClause = search ? { name: { [db.Sequelize.Op.like]: `%${search}%` } } : {};

      // Get total count separately to ensure accuracy
      const count = await db.Team.count({ where: whereClause });

      // Fetch teams with pagination
      const teams = await db.Team.findAll({
        where: whereClause,
        include: [
          {
            model: db.User,
            as: "Users",
            through: { attributes: ["role", "note", "projectId"] },
            attributes: ["id", "firstName", "lastName", "email"],
          },
          {
            model: db.Project,
            as: "Projects",
            include: [
              {
                model: db.Task,
                as: "Tasks",
                include: [
                  {
                    model: db.User,
                    as: "assignee",
                    attributes: ["id", "firstName", "lastName", "email"],
                  },
                ],
              },
            ],
          },
        ],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
        order: [["createdAt", "DESC"]],
      });

      // Format response
      const formattedTeams = teams.map((team) => ({
        teamId: team.id,
        teamName: team.name,
        description: team.description,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
        users: team.Users.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.UserTeam.role,
          note: user.UserTeam.note,
          projectId: user.UserTeam.projectId,
        })),
        projects: team.Projects.map((project) => ({
          id: project.id,
          name: project.name,
          tasks: project.Tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            dueDate: task.dueDate,
            assignee: task.assignee
              ? { userId: task.assignee.id, firstName: task.assignee.firstName, lastName: task.assignee.lastName, email: task.assignee.email }
              : null,
          })),
        })),
      }));

      // Pagination metadata
      const pagination = {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalItems: count,
        itemsPerPage: limitNum,
      };

      res.status(200).json({ teams: formattedTeams, pagination });
    } catch (err) {
      console.error("Get all teams error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to fetch teams", details: err.message });
    }
  },

  // Get a single team by ID
  async getTeamById(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: "id is required" });
      }

      // Fetch team with Sequelize
      const team = await db.Team.findByPk(id, {
        include: [
          { model: db.User, as: "Users", through: { attributes: ["role", "note", "projectId"] } },
          { model: db.Project, as: "Projects", include: [{ model: db.Task, as: "Tasks", include: [{ model: db.User, as: "assignee" }] }] },
        ],
      });

      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }

      // Format response
      const teamResponse = {
        teamId: team.id,
        teamName: team.name,
        description: team.description,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
        users: team.Users.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.UserTeam.role,
          note: user.UserTeam.note,
          projectId: user.UserTeam.projectId,
        })),
        projects: team.Projects.map((project) => ({
          id: project.id,
          name: project.name,
          tasks: project.Tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            dueDate: task.dueDate,
            assignee: task.assignee
              ? { userId: task.assignee.id, firstName: task.assignee.firstName, lastName: task.assignee.lastName, email: task.assignee.email }
              : null,
          })),
        })),
      };

      res.json(teamResponse);
    } catch (err) {
      console.error("Get team by ID error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        teamId: req.params.id,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ error: "Failed to fetch team", details: err.message });
    }
  },

  // Update a team
  async updateTeam(req, res) {
    try {
      const { id } = req.params;
      const { name, description, users } = req.body;

      if (!id) {
        return res.status(400).json({ message: "id is required" });
      }

      // Fetch team
      const [team] = await db.sequelize.query(
        `
        SELECT id, name, description, createdAt, updatedAt
        FROM Teams
        WHERE id = ?
        `,
        {
          replacements: [id],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }

      req.body._previousData = team.toJSON();

      // Build update query
      const updateFields = [];
      const updateReplacements = [];
      if (name) {
        updateFields.push("name = ?");
        updateReplacements.push(name);
      }
      if (description !== undefined) {
        updateFields.push("description = ?");
        updateReplacements.push(description || null);
      }
      updateFields.push("updatedAt = NOW()");

      if (updateFields.length > 1) {
        await db.sequelize.query(
          `
          UPDATE Teams
          SET ${updateFields.join(", ")}
          WHERE id = ?
          `,
          {
            replacements: [...updateReplacements, id],
            type: db.sequelize.QueryTypes.UPDATE,
          }
        );
      }

      // Handle user assignments
      let userResults = [];
      if (users && Array.isArray(users)) {
        userResults = await Promise.all(
          users.map(async (user) => {
            if (!user.id) {
              return { userId: null, status: "failed", reason: "Missing userId" };
            }

            const [existingUser] = await db.sequelize.query(
              `
              SELECT id
              FROM Users
              WHERE id = ?
              `,
              {
                replacements: [user.id],
                type: db.sequelize.QueryTypes.SELECT,
              }
            );

            if (!existingUser) {
              return { userId: user.id, status: "failed", reason: "User not found" };
            }

            const [existingAssignment] = await db.sequelize.query(
              `
              SELECT teamId, userId
              FROM UserTeams
              WHERE teamId = ? AND userId = ?
              `,
              {
                replacements: [id, user.id],
                type: db.sequelize.QueryTypes.SELECT,
              }
            );

            if (existingAssignment) {
              await db.sequelize.query(
                `
                UPDATE UserTeams
                SET role = ?, note = ?, projectId = ?, updatedAt = NOW()
                WHERE teamId = ? AND userId = ?
                `,
                {
                  replacements: [
                    user.role || "Member",
                    user.note || null,
                    user.projectId || null,
                    id,
                    user.id,
                  ],
                  type: db.sequelize.QueryTypes.UPDATE,
                }
              );
            } else {
              await db.sequelize.query(
                `
                INSERT INTO UserTeams (teamId, userId, role, note, projectId, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, NOW(), NOW())
                `,
                {
                  replacements: [
                    id,
                    user.id,
                    user.role || "Member",
                    user.note || null,
                    user.projectId || null,
                  ],
                  type: db.sequelize.QueryTypes.INSERT,
                }
              );
            }
            return { userId: user.id, status: "success" };
          })
        );
      }

      // Fetch updated team
      const updatedTeam = await db.Team.findByPk(id, {
        include: [
          { model: db.User, as: "Users", through: { attributes: ["role", "note", "projectId"] } },
          { model: db.Project, as: "Projects", include: [{ model: db.Task, as: "Tasks", include: [{ model: db.User, as: "assignee" }] }] },
        ],
      });

      if (!updatedTeam) {
        return res.status(500).json({ error: "Failed to fetch updated team" });
      }

      // Format response
      const teamResponse = {
        teamId: updatedTeam.id,
        teamName: updatedTeam.name,
        description: updatedTeam.description,
        createdAt: updatedTeam.createdAt,
        updatedAt: updatedTeam.updatedAt,
        users: updatedTeam.Users.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.UserTeam.role,
          note: user.UserTeam.note,
          projectId: user.UserTeam.projectId,
        })),
        projects: updatedTeam.Projects.map((project) => ({
          id: project.id,
          name: project.name,
          tasks: project.Tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            dueDate: task.dueDate,
            assignee: task.assignee
              ? { userId: task.assignee.id, firstName: task.assignee.firstName, lastName: task.assignee.lastName, email: task.assignee.email }
              : null,
          })),
        })),
      };

      // Notify users
      const allUsers = await db.User.findAll({
        attributes: ["email"],
      });
      const userEmails = updatedTeam.Users.map((u) => u.email);
      const emails = [...allUsers.map((u) => u.email), ...userEmails].filter(
        (email, index, self) => email && self.indexOf(email) === index
      );

      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: "🔄 Team Updated",
          html: `
            <p>Hello,</p>
            <p>The team <strong>${updatedTeam.name}</strong> has been updated by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
            <p><strong>Description:</strong> ${updatedTeam.description || "No description"}</p>
            <p><strong>Users:</strong> ${updatedTeam.Users.map((u) => `${u.firstName} ${u.lastName}`).join(", ") || "None"}</p>
            <p>Best,<br>Team</p>
          `,
        });
      } else {
        console.warn("No emails found for notification", {
          userId: req.user.id,
          teamId: id,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({ message: "Team updated", team: teamResponse, userResults });
    } catch (err) {
      console.error("Update team error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        teamId: req.params.id,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ error: "Failed to update team", details: err.message });
    }
  },

  // Delete a team
  async deleteTeam(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: "id is required" });
      }

      // Fetch team with users for notification
      const [team] = await db.sequelize.query(
        `
        SELECT t.id, t.name, t.description,
               u.id AS userId, u.firstName, u.lastName, u.email
        FROM Teams t
        LEFT JOIN UserTeams ut ON t.id = ut.teamId
        LEFT JOIN Users u ON ut.userId = u.id
        WHERE t.id = ?
        `,
        {
          replacements: [id],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }

      req.body._deletedData = team.toJSON();

      // Delete team and user assignments with raw SQL
      await db.sequelize.query(
        `
        DELETE FROM UserTeams
        WHERE teamId = ?
        `,
        {
          replacements: [id],
          type: db.sequelize.QueryTypes.DELETE,
        }
      );

      await db.sequelize.query(
        `
        DELETE FROM Teams
        WHERE id = ?
        `,
        {
          replacements: [id],
          type: db.sequelize.QueryTypes.DELETE,
        }
      );

      // Notify users
      const users = await db.User.findAll({
        attributes: ["email"],
      });
      const teamUsers = await db.sequelize.query(
        `
        SELECT u.email
        FROM UserTeams ut
        JOIN Users u ON ut.userId = u.id
        WHERE ut.teamId = ?
        `,
        {
          replacements: [id],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );
      const emails = [...users.map((u) => u.email), ...teamUsers.map((u) => u.email)].filter(
        (email, index, self) => email && self.indexOf(email) === index && email !== req.user.email
      );

      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: "🗑️ Team Deleted",
          html: `
            <p>Hello,</p>
            <p>The team <strong>${team.name}</strong> has been deleted by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
            <p><strong>Description:</strong> ${team.description || "No description"}</p>
            <p>Best,<br>Team</p>
          `,
        });
      } else {
        console.warn("No emails found for notification", {
          userId: req.user.id,
          teamId: id,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({ message: "Team deleted" });
    } catch (err) {
      console.error("Delete team error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        teamId: req.params.id,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ error: "Failed to delete team", details: err.message });
    }
  },

  // Assign users to a team
  async assignUsersToTeam(req, res) {
    try {
      const { teamId, users } = req.body;

      if (!teamId || !users || !Array.isArray(users) || users.length === 0) {
        return res.status(400).json({ message: "teamId and users array are required" });
      }

      // Check if team exists
      const [team] = await db.sequelize.query(
        `
        SELECT id, name
        FROM Teams
        WHERE id = ?
        `,
        {
          replacements: [teamId],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }

      // Process user assignments
      const results = await Promise.all(
        users.map(async (user) => {
          if (!user.id) {
            return { userId: null, status: "failed", reason: "Missing userId" };
          }

          const [existingUser] = await db.sequelize.query(
            `
            SELECT id, firstName, lastName, email
            FROM Users
            WHERE id = ?
            `,
            {
              replacements: [user.id],
              type: db.sequelize.QueryTypes.SELECT,
            }
          );

          if (!existingUser) {
            return { userId: user.id, status: "failed", reason: "User not found" };
          }

          const [existingAssignment] = await db.sequelize.query(
            `
            SELECT teamId, userId
            FROM UserTeams
            WHERE teamId = ? AND userId = ?
            `,
            {
              replacements: [teamId, user.id],
              type: db.sequelize.QueryTypes.SELECT,
            }
          );

          if (existingAssignment) {
            return { userId: user.id, status: "failed", reason: "User already assigned" };
          }

          // Insert user into UserTeams with optional projectId
          await db.sequelize.query(
            `
            INSERT INTO UserTeams (teamId, userId, role, note, projectId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
            `,
            {
              replacements: [
                teamId,
                user.id,
                user.role || "Member",
                user.note || null,
                user.projectId || null,
              ],
              type: db.sequelize.QueryTypes.INSERT,
            }
          );

          return { userId: user.id, status: "success", user: existingUser };
        })
      );

      // Fetch updated team
      const updatedTeam = await db.Team.findByPk(teamId, {
        include: [
          { model: db.User, as: "Users", through: { attributes: ["role", "note", "projectId"] } },
          { model: db.Project, as: "Projects", include: [{ model: db.Task, as: "Tasks", include: [{ model: db.User, as: "assignee" }] }] },
        ],
      });

      // Format response
      const teamResponse = {
        teamId: updatedTeam.id,
        teamName: updatedTeam.name,
        description: updatedTeam.description,
        createdAt: updatedTeam.createdAt,
        updatedAt: updatedTeam.updatedAt,
        users: updatedTeam.Users.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.UserTeam.role,
          note: user.UserTeam.note,
          projectId: user.UserTeam.projectId,
        })),
        projects: updatedTeam.Projects.map((project) => ({
          id: project.id,
          name: project.name,
          tasks: project.Tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            dueDate: task.dueDate,
            assignee: task.assignee
              ? { userId: task.assignee.id, firstName: task.assignee.firstName, lastName: task.assignee.lastName, email: task.assignee.email }
              : null,
          })),
        })),
      };

      // Notify users
      const usersAll = await db.User.findAll({
        attributes: ["email"],
      });
      const assignedUsers = results
        .filter((r) => r.status === "success")
        .map((r) => r.user.email);
      const emails = [...usersAll.map((u) => u.email), ...assignedUsers].filter(
        (email, index, self) => email && self.indexOf(email) === index
      );

      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: "👥 Users Assigned to Team",
          html: `
            <p>Hello,</p>
            <p>Users have been assigned to the team <strong>${updatedTeam.name}</strong> by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
            <p><strong>Assigned Users:</strong> ${results
              .filter((r) => r.status === "success")
              .map((r) => `${r.user.firstName} ${r.user.lastName}`)
              .join(", ") || "None"}</p>
            <p>Best,<br>Team</p>
          `,
        });
      } else {
        console.warn("No emails found for notification", {
          userId: req.user.id,
          teamId,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        message: "Users assigned to team",
        team: teamResponse,
        userCount: results.filter((r) => r.status === "success").length,
        results,
      });
    } catch (err) {
      console.error("Assign users to team error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ error: "Failed to assign users to team", details: err.message });
    }
  },

  // Unassign users from a team
  async unassignUsersFromTeam(req, res) {
    try {
      const { teamId, userIds } = req.body;

      if (!teamId || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ message: "teamId and userIds array are required" });
      }

      // Check if team exists
      const [team] = await db.sequelize.query(
        `
        SELECT id, name
        FROM Teams
        WHERE id = ?
        `,
        {
          replacements: [teamId],
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }

      // Process user unassignments
      const results = await Promise.all(
        userIds.map(async (userId) => {
          const [user] = await db.sequelize.query(
            `
            SELECT id, firstName, lastName, email
            FROM Users
            WHERE id = ?
            `,
            {
              replacements: [userId],
              type: db.sequelize.QueryTypes.SELECT,
            }
          );

          if (!user) {
            return { userId, status: "failed", reason: "User not found" };
          }

          const [existingAssignment] = await db.sequelize.query(
            `
            SELECT teamId, userId
            FROM UserTeams
            WHERE teamId = ? AND userId = ?
            `,
            {
              replacements: [teamId, userId],
              type: db.sequelize.QueryTypes.SELECT,
            }
          );

          if (!existingAssignment) {
            return { userId, status: "failed", reason: "Not assigned" };
          }

          await db.sequelize.query(
            `
            DELETE FROM UserTeams
            WHERE teamId = ? AND userId = ?
            `,
            {
              replacements: [teamId, userId],
              type: db.sequelize.QueryTypes.DELETE,
            }
          );

          return { userId, status: "success", user };
        })
      );

      // Fetch updated team
      const updatedTeam = await db.Team.findByPk(teamId, {
        include: [
          { model: db.User, as: "Users", through: { attributes: ["role", "note", "projectId"] } },
          { model: db.Project, as: "Projects", include: [{ model: db.Task, as: "Tasks", include: [{ model: db.User, as: "assignee" }] }] },
        ],
      });

      // Format response
      const teamResponse = {
        teamId: updatedTeam.id,
        teamName: updatedTeam.name,
        description: updatedTeam.description,
        createdAt: updatedTeam.createdAt,
        updatedAt: updatedTeam.updatedAt,
        users: updatedTeam.Users.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.UserTeam.role,
          note: user.UserTeam.note,
          projectId: user.UserTeam.projectId,
        })),
        projects: updatedTeam.Projects.map((project) => ({
          id: project.id,
          name: project.name,
          tasks: project.Tasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            dueDate: task.dueDate,
            assignee: task.assignee
              ? { userId: task.assignee.id, firstName: task.assignee.firstName, lastName: task.assignee.lastName, email: task.assignee.email }
              : null,
          })),
        })),
      };

      // Notify users
      const usersAll = await db.User.findAll({
        attributes: ["email"],
      });
      const unassignedUsers = results
        .filter((r) => r.status === "success")
        .map((r) => r.user.email);
      const emails = [...usersAll.map((u) => u.email), ...unassignedUsers].filter(
        (email, index, self) => email && self.indexOf(email) === index && email !== req.user.email
      );

      if (emails.length > 0) {
        await sendMail({
          to: emails,
          subject: "👤 Users Unassigned from Team",
          html: `
            <p>Hello,</p>
            <p>Users have been unassigned from the team <strong>${updatedTeam.name}</strong> by <strong>${req.user.firstName} ${req.user.lastName}</strong>.</p>
            <p><strong>Unassigned Users:</strong> ${results
              .filter((r) => r.status === "success")
              .map((r) => `${r.user.firstName} ${r.user.lastName}`)
              .join(", ") || "None"}</p>
            <p>Best,<br>Team</p>
          `,
        });
      } else {
        console.warn("No emails found for notification", {
          userId: req.user.id,
          teamId,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        message: "Users unassigned from team",
        team: teamResponse,
        userCount: results.filter((r) => r.status === "success").length,
        results,
      });
    } catch (err) {
      console.error("Unassign users from team error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ error: "Failed to unassign users from team", details: err.message });
    }
  },
};
