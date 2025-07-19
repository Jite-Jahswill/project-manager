const db = require("../models");
const sendMail = require("../utils/mailer");
const { notifyClientOnProjectCompletion } = require("./client.controller");

module.exports = {
  // Create a new project (Admin or Manager)
  async createProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only admins or managers can create projects" });
      }
      const { name, description, startDate, endDate } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Project name is required" });
      }

      const project = await db.Project.create({
        name,
        description: description || null,
        startDate: startDate || null,
        endDate: endDate || null,
        status: "To Do",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return res.status(201).json({
        message: "Project created successfully",
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          startDate: project.startDate,
          endDate: project.endDate,
          status: project.status,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          team: null,
          tasks: [],
          clients: [],
        },
      });
    } catch (err) {
      console.error("Create project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to create project", details: err.message });
    }
  },

  // Get project by ID (All authenticated users)
  async getProjectById(req, res) {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
      }

      const project = await db.Project.findByPk(projectId, {
        include: [
          {
            model: db.Team,
            attributes: ["id", "name"],
            include: [
              {
                model: db.User,
                attributes: ["id", "firstName", "lastName", "email", "phoneNumber"],
                through: { attributes: ["role", "note"] },
              },
            ],
          },
          {
            model: db.Task,
            as: "Tasks", // Fixed alias to match model
            attributes: ["id", "title", "description", "status", "dueDate"],
            include: [
              {
                model: db.User,
                as: "assignee",
                attributes: ["id", "firstName", "lastName", "email"],
              },
            ],
          },
          {
            model: db.Client,
            as: "Clients",
            attributes: ["id", "firstName", "lastName", "email", "image"],
            through: { attributes: [] },
          },
        ],
      });

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.status(200).json({
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          startDate: project.startDate,
          endDate: project.endDate,
          status: project.status,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          team: project.Team
            ? {
                teamId: project.Team.id,
                teamName: project.Team.name,
                members: project.Team.Users.map((user) => ({
                  userId: user.id,
                  firstName: user.firstName,
                  lastName: user.lastName,
                  email: user.email,
                  phoneNumber: user.phoneNumber || null,
                  role: user.UserTeam.role,
                  note: user.UserTeam.note,
                })),
              }
            : null,
          tasks: project.Tasks.map((task) => ({
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
          clients: project.Clients.map((client) => ({
            id: client.id,
            firstName: client.firstName,
            lastName: client.lastName,
            email: client.email,
            image: client.image,
          })),
        },
      });
    } catch (err) {
      console.error("Get project by ID error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        projectId: req.params.projectId,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to fetch project", details: err.message });
    }
  },

  // Get projects for the authenticated user (All authenticated users)
  async getMyProjects(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: "Invalid page or limit" });
      }

      let whereClause = {};
      if (req.user.role === "client") {
        whereClause = {
          id: {
            [db.Sequelize.Op.in]: db.sequelize.literal(
              `(SELECT projectId FROM ClientProjects WHERE clientId = ${req.user.id})`
            ),
          },
        };
      } else {
        whereClause = {
          id: {
            [db.Sequelize.Op.in]: db.sequelize.literal(
              `(SELECT projectId FROM UserTeams WHERE userId = ${req.user.id} AND projectId IS NOT NULL)`
            ),
          },
        };
      }

      const { count, rows } = await db.Project.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: db.Team,
            attributes: ["id", "name"],
            include: [
              {
                model: db.User,
                attributes: ["id", "firstName", "lastName", "email", "phoneNumber"],
                through: { attributes: ["role", "note"] },
              },
            ],
          },
          {
            model: db.Task,
            as: "Tasks", // Fixed alias to match model
            attributes: ["id", "title", "description", "status", "dueDate"],
            include: [
              {
                model: db.User,
                as: "assignee",
                attributes: ["id", "firstName", "lastName", "email"],
              },
            ],
          },
          {
            model: db.Client,
            as: "Clients",
            attributes: ["id", "firstName", "lastName", "email", "image"],
            through: { attributes: [] },
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
      });

      const projects = rows.map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        startDate: project.startDate,
        endDate: project.endDate,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        team: project.Team
          ? {
              teamId: project.Team.id,
              teamName: project.Team.name,
              members: project.Team.Users.map((user) => ({
                userId: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phoneNumber: user.phoneNumber || null,
                role: user.UserTeam.role,
                note: user.UserTeam.note,
              })),
            }
          : null,
        tasks: project.Tasks.map((task) => ({
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
        clients: project.Clients.map((client) => ({
          id: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
          image: client.image,
        })),
      }));

      const pagination = {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalItems: count,
        itemsPerPage: limitNum,
      };

      return res.status(200).json({ projects, pagination });
    } catch (err) {
      console.error("Get my projects error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to retrieve projects", details: err.message });
    }
  },

  // Get all projects (All authenticated users)
  async getAllProjects(req, res) {
    try {
      const { projectName, status, startDate, page = 1, limit = 20 } = req.query;

      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: "Invalid page or limit" });
      }

      const where = {};
      if (projectName) where.name = { [db.Sequelize.Op.like]: `%${projectName}%` };
      if (status) where.status = status;
      if (startDate) where.startDate = startDate;

      const { count, rows } = await db.Project.findAndCountAll({
        where,
        include: [
          {
            model: db.Team,
            attributes: ["id", "name"],
            include: [
              {
                model: db.User,
                attributes: ["id", "firstName", "lastName", "email", "phoneNumber"],
                through: { attributes: ["role", "note"] },
              },
            ],
          },
          {
            model: db.Task,
            as: "Tasks", // Fixed alias to match model
            attributes: ["id", "title", "description", "status", "dueDate"],
            include: [
              {
                model: db.User,
                as: "assignee",
                attributes: ["id", "firstName", "lastName", "email"],
              },
            ],
          },
          {
            model: db.Client,
            as: "Clients",
            attributes: ["id", "firstName", "lastName", "email", "image"],
            through: { attributes: [] },
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: limitNum,
        offset: (pageNum - 1) * limitNum,
      });

      const projects = rows.map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        startDate: project.startDate,
        endDate: project.endDate,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        team: project.Team
          ? {
              teamId: project.Team.id,
              teamName: project.Team.name,
              members: project.Team.Users.map((user) => ({
                userId: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phoneNumber: user.phoneNumber || null,
                role: user.UserTeam.role,
                note: user.UserTeam.note,
              })),
            }
          : null,
        tasks: project.Tasks.map((task) => ({
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
        clients: project.Clients.map((client) => ({
          id: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
          image: client.image,
        })),
      }));

      const pagination = {
        currentPage: pageNum,
        totalPages: Math.ceil(count / limitNum),
        totalItems: count,
        itemsPerPage: limitNum,
      };

      return res.status(200).json({ projects, pagination });
    } catch (err) {
      console.error("Get projects error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to retrieve projects", details: err.message });
    }
  },

  // Assign an entire team to a project
  async assignTeamToProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only admins or managers can assign teams to projects" });
      }

      const { teamId, projectId } = req.body;
      if (!teamId || !projectId) {
        return res.status(400).json({ message: "teamId and projectId are required" });
      }

      const transaction = await db.sequelize.transaction();

      try {
        const team = await db.Team.findByPk(teamId, { transaction });
        if (!team) {
          await transaction.rollback();
          return res.status(404).json({ message: "Team not found" });
        }

        const project = await db.Project.findByPk(projectId, { transaction });
        if (!project) {
          await transaction.rollback();
          return res.status(404).json({ message: "Project not found" });
        }

        const teamMembers = await db.User.findAll({
          include: [
            {
              model: db.Team,
              where: { id: teamId },
              attributes: [],
              through: { attributes: [] },
            },
          ],
          attributes: ["id", "email", "firstName", "lastName", "phoneNumber"],
          transaction,
        });

        await db.Project.update(
          { teamId, updatedAt: new Date() },
          { where: { id: projectId }, transaction }
        );

        const emailPromises = teamMembers.map((user) =>
          sendMail({
            to: user.email,
            subject: `Your Team Has Been Assigned to Project: ${project.name}`,
            html: `
              <p>Hello ${user.firstName},</p>
              <p>Your team <strong>${team.name}</strong> has been assigned to the project <strong>${project.name}</strong>.</p>
              <p><strong>Start Date:</strong> ${project.startDate || "TBD"}</p>
              <p><strong>End Date:</strong> ${project.endDate || "TBD"}</p>
              <p><strong>Contact Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
              <p>Please log in to view your tasks.</p>
              <p>Best,<br>Team</p>
            `,
          })
        );

        await Promise.all(emailPromises);

        await transaction.commit();

        return res.status(200).json({
          message: `Team "${team.name}" assigned to project successfully`,
          team: {
            teamId: team.id,
            teamName: team.name,
            members: teamMembers.map((u) => ({
              userId: u.id,
              email: u.email,
              name: `${u.firstName} ${u.lastName}`,
              phoneNumber: u.phoneNumber || null,
            })),
          },
        });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error("Assign team error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to assign team to project", details: err.message });
    }
  },

  // Remove a team from a project
  async removeTeamFromProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only admins or managers can remove teams from projects" });
      }

      const { teamId, projectId } = req.body;
      if (!teamId || !projectId) {
        return res.status(400).json({ message: "teamId and projectId are required" });
      }

      const transaction = await db.sequelize.transaction();

      try {
        const team = await db.Team.findByPk(teamId, { transaction });
        if (!team) {
          await transaction.rollback();
          return res.status(404).json({ message: "Team not found" });
        }

        const project = await db.Project.findByPk(projectId, { transaction });
        if (!project) {
          await transaction.rollback();
          return res.status(404).json({ message: "Project not found" });
        }
        if (project.teamId !== parseInt(teamId)) {
          await transaction.rollback();
          return res.status(400).json({ message: "Team is not assigned to this project" });
        }

        const teamMembers = await db.User.findAll({
          include: [
            {
              model: db.Team,
              where: { id: teamId },
              attributes: [],
              through: { attributes: [] },
            },
          ],
          attributes: ["id", "email", "firstName", "lastName", "phoneNumber"],
          transaction,
        });

        await db.Project.update(
          { teamId: null, updatedAt: new Date() },
          { where: { id: projectId }, transaction }
        );

        const emailPromises = teamMembers.map((user) =>
          sendMail({
            to: user.email,
            subject: `Your Team Has Been Removed from Project: ${project.name}`,
            html: `
              <p>Hello ${user.firstName},</p>
              <p>Your team <strong>${team.name}</strong> has been removed from the project <strong>${project.name}</strong>.</p>
              <p><strong>Start Date:</strong> ${project.startDate || "TBD"}</p>
              <p><strong>End Date:</strong> ${project.endDate || "TBD"}</p>
              <p><strong>Contact Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
              <p>Please check your dashboard for updated assignments.</p>
              <p>Best,<br>Team</p>
            `,
          })
        );

        await Promise.all(emailPromises);

        await transaction.commit();

        return res.status(200).json({
          message: `Team "${team.name}" removed from project successfully`,
          team: {
            teamId: team.id,
            teamName: team.name,
            members: teamMembers.map((u) => ({
              userId: u.id,
              email: u.email,
              name: `${u.firstName} ${u.lastName}`,
              phoneNumber: u.phoneNumber || null,
            })),
          },
        });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error("Remove team from project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to remove team from project", details: err.message });
    }
  },

  // Get all members of a project with roles
  async getProjectMembers(req, res) {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
      }

      const project = await db.Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const members = await db.User.findAll({
        include: [
          {
            model: db.Project,
            where: { id: projectId },
            attributes: [],
            through: { attributes: ["role", "note"] },
          },
        ],
        attributes: ["id", "firstName", "lastName", "email", "phoneNumber"],
      });

      const formattedMembers = members.map((user) => ({
        userId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber || null,
        role: user.UserTeam.role,
        note: user.UserTeam.note,
      }));

      return res.status(200).json({ members: formattedMembers });
    } catch (err) {
      console.error("Get members error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        projectId: req.params.projectId,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to retrieve project members", details: err.message });
    }
  },

  // Update project status
  async updateProjectStatus(req, res) {
    try {
      const { projectId } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }

      const validStatuses = ["To Do", "In Progress", "Review", "Done"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      const project = await db.Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const assigned = await db.UserTeam.findOne({
        where: { userId: req.user.id, projectId },
      });

      if (!assigned && req.user.role !== "client" && req.user.role !== "admin") {
        return res.status(403).json({ message: "You're not assigned to this project" });
      }

      await db.Project.update(
        { status, updatedAt: new Date() },
        { where: { id: projectId } }
      );

      const updatedProject = await db.Project.findByPk(projectId, {
        include: [
          {
            model: db.Team,
            attributes: ["id", "name"],
            include: [
              {
                model: db.User,
                attributes: ["id", "firstName", "lastName", "email", "phoneNumber"],
                through: { attributes: ["role", "note"] },
              },
            ],
          },
          {
            model: db.Task,
            as: "Tasks", // Fixed alias to match model
            attributes: ["id", "title", "description", "status", "dueDate"],
            include: [
              {
                model: db.User,
                as: "assignee",
                attributes: ["id", "firstName", "lastName", "email"],
              },
            ],
          },
          {
            model: db.Client,
            as: "Clients",
            attributes: ["id", "firstName", "lastName", "email", "image"],
            through: { attributes: [] },
          },
        ],
      });

      const assignedUsers = await db.User.findAll({
        include: [
          {
            model: db.Project,
            where: { id: projectId },
            attributes: [],
            through: { attributes: [] },
          },
        ],
        attributes: ["email", "firstName", "phoneNumber"],
      });

      const adminsAndManagers = await db.User.findAll({
        where: { role: ["admin", "manager"] },
        attributes: ["email", "firstName", "phoneNumber"],
      });

      const uniqueEmails = new Set([
        ...assignedUsers.map((u) => u.email),
        ...adminsAndManagers.map((u) => u.email),
      ]);

      const emailPromises = Array.from(uniqueEmails).map((email) =>
        sendMail({
          to: email,
          subject: `Project Status Updated: ${project.name}`,
          html: `
            <p>Hello,</p>
            <p>The status of project <strong>${project.name}</strong> has been updated to <strong>${status}</strong>.</p>
            <p><strong>Contact Phone:</strong> ${
              assignedUsers.find((u) => u.email === email)?.phoneNumber ||
              adminsAndManagers.find((u) => u.email === email)?.phoneNumber ||
              "Not provided"
            }</p>
            <p>Best regards,<br>Team</p>
          `,
        })
      );

      await Promise.all(emailPromises);

      if (status.toLowerCase() === "done") {
        await notifyClientOnProjectCompletion(projectId);
      }

      return res.status(200).json({
        message: "Status updated successfully",
        project: {
          id: updatedProject.id,
          name: updatedProject.name,
          description: updatedProject.description,
          startDate: updatedProject.startDate,
          endDate: updatedProject.endDate,
          status: updatedProject.status,
          createdAt: updatedProject.createdAt,
          updatedAt: updatedProject.updatedAt,
          team: updatedProject.Team
            ? {
                teamId: updatedProject.Team.id,
                teamName: updatedProject.Team.name,
                members: updatedProject.Team.Users.map((user) => ({
                  userId: user.id,
                  firstName: user.firstName,
                  lastName: user.lastName,
                  email: user.email,
                  phoneNumber: user.phoneNumber || null,
                  role: user.UserTeam.role,
                  note: user.UserTeam.note,
                })),
              }
            : null,
          tasks: updatedProject.Tasks.map((task) => ({
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
          clients: updatedProject.Clients.map((client) => ({
            id: client.id,
            firstName: client.firstName,
            lastName: client.lastName,
            email: client.email,
            image: client.image,
          })),
        },
      });
    } catch (err) {
      console.error("Update status error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        projectId: req.params.projectId,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to update status", details: err.message });
    }
  },

  // Update full project (admin or manager)
  async updateProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only admins or managers can update projects" });
      }

      const { projectId } = req.params;
      const { name, description, startDate, endDate, status, teamId } = req.body;

      const project = await db.Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      if (teamId) {
        const team = await db.Team.findByPk(teamId);
        if (!team) {
          return res.status(404).json({ message: "Team not found" });
        }
      }

      const updates = {};
      if (name) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (startDate) updates.startDate = startDate;
      if (endDate !== undefined) updates.endDate = endDate;
      if (status) {
        const validStatuses = ["To Do", "In Progress", "Review", "Done"];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ message: "Invalid status value" });
        }
        updates.status = status;
      }
      if (teamId) updates.teamId = teamId;
      updates.updatedAt = new Date();

      if (Object.keys(updates).length > 0) {
        await db.Project.update(updates, { where: { id: projectId } });
      }

      const updatedProject = await db.Project.findByPk(projectId, {
        include: [
          {
            model: db.Team,
            attributes: ["id", "name"],
            include: [
              {
                model: db.User,
                attributes: ["id", "firstName", "lastName", "email", "phoneNumber"],
                through: { attributes: ["role", "note"] },
              },
            ],
          },
          {
            model: db.Task,
            as: "Tasks", // Fixed alias to match model
            attributes: ["id", "title", "description", "status", "dueDate"],
            include: [
              {
                model: db.User,
                as: "assignee",
                attributes: ["id", "firstName", "lastName", "email"],
              },
            ],
          },
          {
            model: db.Client,
            as: "Clients",
            attributes: ["id", "firstName", "lastName", "email", "image"],
            through: { attributes: [] },
          },
        ],
      });

      if (teamId) {
        const teamMembers = await db.User.findAll({
          include: [
            {
              model: db.Team,
              where: { id: teamId },
              attributes: [],
              through: { attributes: [] },
            },
          ],
          attributes: ["email", "firstName", "phoneNumber"],
        });

        const emailPromises = teamMembers.map((user) =>
          sendMail({
            to: user.email,
            subject: `Project Updated: ${name || project.name}`,
            html: `
              <p>Hello ${user.firstName},</p>
              <p>Your team has been assigned to the updated project <strong>${name || project.name}</strong>.</p>
              <p><strong>Start Date:</strong> ${startDate || project.startDate || "TBD"}</p>
              <p><strong>End Date:</strong> ${endDate || project.endDate || "TBD"}</p>
              <p><strong>Status:</strong> ${status || project.status}</p>
              <p><strong>Contact Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
              <p>Check your dashboard for details.</p>
              <p>Best,<br>Team</p>
            `,
          })
        );

        await Promise.all(emailPromises);
      }

      if (status && status.toLowerCase() === "done") {
        await notifyClientOnProjectCompletion(projectId);
      }

      return res.status(200).json({
        message: "Project updated successfully",
        project: {
          id: updatedProject.id,
          name: updatedProject.name,
          description: updatedProject.description,
          startDate: updatedProject.startDate,
          endDate: updatedProject.endDate,
          status: updatedProject.status,
          createdAt: updatedProject.createdAt,
          updatedAt: updatedProject.updatedAt,
          team: updatedProject.Team
            ? {
                teamId: updatedProject.Team.id,
                teamName: updatedProject.Team.name,
                members: updatedProject.Team.Users.map((user) => ({
                  userId: user.id,
                  firstName: user.firstName,
                  lastName: user.lastName,
                  email: user.email,
                  phoneNumber: user.phoneNumber || null,
                  role: user.UserTeam.role,
                  note: user.UserTeam.note,
                })),
              }
            : null,
          tasks: updatedProject.Tasks.map((task) => ({
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
          clients: updatedProject.Clients.map((client) => ({
            id: client.id,
            firstName: client.firstName,
            lastName: client.lastName,
            email: client.email,
            image: client.image,
          })),
        },
      });
    } catch (err) {
      console.error("Update project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        projectId: req.params.projectId,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to update project", details: err.message });
    }
  },

  // Delete a project (admin or manager)
  async deleteProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only admins or managers can delete projects" });
      }

      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
      }

      const transaction = await db.sequelize.transaction();

      try {
        const project = await db.Project.findByPk(projectId, { transaction });
        if (!project) {
          await transaction.rollback();
          return res.status(404).json({ message: "Project not found" });
        }

        const teamMembers = project.teamId
          ? await db.User.findAll({
              include: [
                {
                  model: db.Team,
                  where: { id: project.teamId },
                  attributes: [],
                  through: { attributes: [] },
                },
              ],
              attributes: ["email", "firstName", "phoneNumber"],
              transaction,
            })
          : [];

        const clients = await db.Client.findAll({
          include: [
            {
              model: db.Project,
              where: { id: projectId },
              attributes: [],
              through: { attributes: [] },
            },
          ],
          attributes: ["email", "firstName"],
          transaction,
        });

        await db.Project.destroy({ where: { id: projectId }, transaction });

        const emailPromises = [
          ...teamMembers.map((user) =>
            sendMail({
              to: user.email,
              subject: `Project Deleted: ${project.name}`,
              html: `
                <p>Hello ${user.firstName},</p>
                <p>The project <strong>${project.name}</strong> has been deleted.</p>
                <p><strong>Contact Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
                <p>Please check your dashboard for updated assignments.</p>
                <p>Best,<br>Team</p>
              `,
            })
          ),
          ...clients.map((client) =>
            sendMail({
              to: client.email,
              subject: `Project Deleted: ${project.name}`,
              html: `
                <p>Hello ${client.firstName},</p>
                <p>The project <strong>${project.name}</strong> has been deleted.</p>
                <p>Please contact us for any questions.</p>
                <p>Best,<br>Team</p>
              `,
            })
          ),
        ];

        await Promise.all(emailPromises);

        await transaction.commit();

        return res.status(200).json({ message: "Project deleted successfully" });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error("Delete project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        projectId: req.params.projectId,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to delete project", details: err.message });
    }
  },

  // Add a client to a project (Admin or Manager only)
  async addClientToProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only admins or managers can add clients" });
      }

      const { projectId, clientId } = req.body;

      if (!projectId || !clientId) {
        return res.status(400).json({ message: "Project ID and Client ID are required." });
      }

      const transaction = await db.sequelize.transaction();

      try {
        const project = await db.Project.findByPk(projectId, { transaction });
        if (!project) {
          await transaction.rollback();
          return res.status(404).json({ message: "Project not found." });
        }

        const client = await db.Client.findByPk(clientId, { transaction });
        if (!client) {
          await transaction.rollback();
          return res.status(404).json({ message: "Client not found." });
        }

        // No association is made here (as requested)

        await transaction.commit();
        return res.status(200).json({ message: "Client validated for project successfully" });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error("Add client to project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to add client to project", details: err.message });
    }
  },

  // Remove a client from a project (Admin or Manager only)
  async removeClientFromProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only admins or managers can remove clients" });
      }

      const { projectId, clientId } = req.params;

      if (!projectId || !clientId) {
        return res.status(400).json({ message: "Project ID and Client ID are required." });
      }

      const transaction = await db.sequelize.transaction();

      try {
        const project = await db.Project.findByPk(projectId, {
          include: [
            {
              model: db.Client,
              as: "Clients",
              where: { id: clientId },
              through: { attributes: [] },
              required: false,
            },
          ],
          transaction,
        });

        if (!project) {
          await transaction.rollback();
          return res.status(404).json({ message: "Project not found." });
        }

        const clientAssociated = project.Clients?.length > 0;

        if (!clientAssociated) {
          await transaction.rollback();
          return res.status(404).json({ message: "No association found between this client and project." });
        }

        // No actual disassociation done here as requested

        await transaction.commit();

        return res.status(200).json({ message: "Client validated and would be removed from project successfully" });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error("Remove client from project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        projectId: req.params.projectId,
        clientId: req.params.clientId,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to remove client from project", details: err.message });
    }
  },
};
