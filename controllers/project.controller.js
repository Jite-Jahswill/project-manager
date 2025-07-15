const db = require("../models");
const Project = db.Project;
const User = db.User;
const UserTeam = db.UserTeam;
const Team = db.Team;
const Client = db.Client;
const sendMail = require("../utils/mailer");
const { notifyClientOnProjectCompletion } = require("./client.controller");

module.exports = {
  // Create a new project (Admin or Manager)
  async createProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res
          .status(403)
          .json({ message: "Only admins or managers can create projects." });
      }
      const { name, description, startDate, endDate } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Project name is required" });
      }
      const project = await Project.create({
        name,
        description,
        startDate,
        endDate,
        status: "Pending",
      });
      return res
        .status(201)
        .json({ message: "Project created successfully", project });
    } catch (err) {
      console.error("Create project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      return res
        .status(500)
        .json({ message: "Failed to create project", details: err.message });
    }
  },

  // Assign an entire team to a project
  async assignTeamToProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({
          message: "Only admins or managers can assign teams to projects.",
        });
      }

      const { teamId, projectId, role } = req.body;
      if (!teamId || !projectId || !role) {
        return res.status(400).json({
          message: "teamId, projectId, and role are required",
        });
      }

      const team = await db.Team.findByPk(teamId, {
        include: [{ model: db.User }],
      });

      const project = await Project.findByPk(projectId);
      if (!team) return res.status(404).json({ message: "Team not found" });
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      const assignedUsers = [];

      for (const user of team.Users) {
        const alreadyAssigned = await UserTeam.findOne({
          where: { userId: user.id, projectId },
        });

        if (!alreadyAssigned) {
          const assignment = await UserTeam.create({
            userId: user.id,
            projectId,
            role,
          });

          assignedUsers.push(user);

          // Send mail to each assigned user
          await sendMail({
            to: user.email,
            subject: `You've been assigned to Project: ${project.name}`,
            html: `
              <p>Hello ${user.firstName},</p>
              <p>You've been assigned to the project <strong>${
                project.name
              }</strong> as a <strong>${role}</strong>.</p>
              <p>Start Date: ${project.startDate}</p>
              <p>End Date: ${project.endDate || "TBD"}</p>
              <p>Please log in to view your tasks.</p>
              <p>Best,<br>Team</p>
            `,
          });
        }
      }

      return res.status(200).json({
        message: `Team assigned to project successfully. ${assignedUsers.length} members added.`,
        assignedMembers: assignedUsers.map((u) => ({
          userId: u.id,
          email: u.email,
          name: `${u.firstName} ${u.lastName}`,
        })),
      });
    } catch (err) {
      console.error("Assign team error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({
        message: "Failed to assign team to project",
        details: err.message,
      });
    }
  },

  // Get all members of a project with roles (All authenticated users)
  async getProjectMembers(req, res) {
    try {
      const { projectId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      if (!projectId)
        return res.status(400).json({ message: "projectId is required" });

      const project = await Project.findByPk(projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const { count, rows } = await UserTeam.findAndCountAll({
        where: { projectId },
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
        ],
        limit: parseInt(limit),
        offset,
      });

      const totalPages = Math.ceil(count / limit);

      const formattedMembers = rows.map((member) => ({
        userId: member.userId,
        firstName: member.User.firstName,
        lastName: member.User.lastName,
        email: member.User.email,
        role: member.role,
      }));

      return res.status(200).json({
        members: formattedMembers,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (err) {
      console.error("Get members error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        projectId: req.params.projectId,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({
        message: "Failed to retrieve project members",
        details: err.message,
      });
    }
  },

  // Get all projects (All authenticated users)
  async getAllProjects(req, res) {
    try {
      const { projectName, status, startDate, page = 1, limit = 20 } = req.query;
      const whereClause = {};

      if (projectName) {
        whereClause.name = {
          [db.Sequelize.Op.like]: `%${projectName}%`,
        };
      }

      if (status) {
        whereClause.status = status;
      }

      if (startDate) {
        whereClause.startDate = startDate;
      }

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const { count, rows } = await db.Project.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: db.Client,
            through: { model: db.ClientProject, attributes: [] },
            attributes: ["id", "firstName", "lastName", "email", "image"],
          },
          {
            model: db.User,
            attributes: ["id", "firstName", "lastName", "email"],
            through: {
              attributes: ["role"],
            },
            include: [
              {
                model: db.Team,
                attributes: ["id", "name"],
                through: { attributes: [] },
              },
            ],
          },
        ],
        limit: parseInt(limit),
        offset,
      });

      const totalPages = Math.ceil(count / limit);

      const formattedProjects = rows.map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        startDate: project.startDate,
        endDate: project.endDate,
        status: project.status,
        client:
          project.Clients && project.Clients.length > 0
            ? {
                id: project.Clients[0].id,
                firstName: project.Clients[0].firstName,
                lastName: project.Clients[0].lastName,
                email: project.Clients[0].email,
                image: project.Clients[0].image,
              }
            : null,
        members: project.Users.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.UserTeam.role,
          teams:
            user.Teams?.map((team) => ({
              teamId: team.id,
              teamName: team.name,
            })) || [],
        })),
      }));

      return res.status(200).json({
        projects: formattedProjects,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (err) {
      console.error("Get projects error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({
        message: "Failed to retrieve projects",
        details: err.message,
      });
    }
  },

  // Update project status (assigned users)
  async updateProjectStatus(req, res) {
    try {
      const { projectId } = req.params;
      const { status } = req.body;
      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }

      const project = await db.Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const assigned = await db.UserTeam.findOne({
        where: { userId: req.user.id, projectId },
      });

      if (!assigned) {
        return res.status(403).json({
          message: "You're not assigned to this project",
        });
      }

      await db.sequelize.query(
        "UPDATE Projects SET status = :status WHERE id = :id",
        {
          replacements: { status, id: projectId },
          type: db.sequelize.QueryTypes.UPDATE,
        }
      );

      // Notify all assigned users, admins, and managers
      const allUsers = await db.User.findAll({
        include: {
          model: db.UserTeam,
          where: { projectId },
        },
      });

      const adminsAndManagers = await db.User.findAll({
        where: {
          role: { [db.Sequelize.Op.in]: ["admin", "manager"] },
        },
      });

      const uniqueEmails = new Set([
        ...allUsers.map((u) => u.email),
        ...adminsAndManagers.map((u) => u.email),
      ]);

      const emailPromises = Array.from(uniqueEmails).map((email) =>
        sendMail({
          to: email,
          subject: `Project Status Updated: ${project.name}`,
          html: `
            <p>Hello,</p>
            <p>The status of project <strong>${project.name}</strong> has been updated to <strong>${status}</strong>.</p>
            <p>Best regards,<br>Team</p>
          `,
        })
      );

      await Promise.all(emailPromises);

      // Notify client if project is completed
      if (status.toLowerCase() === "completed") {
        await notifyClientOnProjectCompletion(projectId);
      }

      // Fetch updated project
      const updatedProject = await db.Project.findByPk(projectId);

      return res.status(200).json({
        message: "Status updated successfully",
        project: updatedProject,
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
      return res.status(500).json({
        message: "Failed to update status",
        details: err.message,
      });
    }
  },

  // Update full project (admin or manager)
  async updateProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res
          .status(403)
          .json({ message: "Only admins or managers can update projects." });
      }

      const { projectId } = req.params;
      const { name, description, startDate, endDate, status, teamId } = req.body;

      const project = await db.Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      await db.sequelize.query(
        "UPDATE Projects SET name = :name, description = :description, startDate = :startDate, endDate = :endDate, status = :status, teamId = :teamId WHERE id = :id",
        {
          replacements: {
            name: name || project.name,
            description: description || project.description,
            startDate: startDate || project.startDate,
            endDate: endDate || project.endDate,
            status: status || project.status,
            teamId: teamId || project.teamId,
            id: projectId,
          },
          type: db.sequelize.QueryTypes.UPDATE,
        }
      );

      // Assign team to project
      if (teamId) {
        const team = await db.Team.findByPk(teamId, {
          include: [{ model: db.User }],
        });
        if (!team) {
          return res.status(404).json({ message: "Team not found" });
        }

        // Clear existing UserTeam entries for this project
        await db.UserTeam.destroy({ where: { projectId } });

        // Assign each team member to the project
        const userAssignments = team.Users.map((user) =>
          db.UserTeam.create({
            userId: user.id,
            projectId,
            role: "Developer",
          })
        );

        await Promise.all(userAssignments);

        // Notify users
        const emailPromises = team.Users.map((user) =>
          sendMail({
            to: user.email,
            subject: `Project Updated: ${project.name}`,
            html: `
              <p>Hello ${user.firstName},</p>
              <p>You’ve been assigned to the updated project <strong>${project.name}</strong>.</p>
              <p>Check your dashboard for details.</p>
              <p>Best,<br>Team</p>
            `,
          })
        );

        await Promise.all(emailPromises);
      }

      // Fetch updated project
      const updatedProject = await db.Project.findByPk(projectId);

      return res.status(200).json({ message: "Project updated", project: updatedProject });
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
      return res
        .status(500)
        .json({ message: "Failed to update project", details: err.message });
    }
  },

  // Delete project (admin or manager)
  async deleteProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res
          .status(403)
          .json({ message: "Only admins or managers can delete projects." });
      }

      const { projectId } = req.params;

      const project = await db.Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Fetch assigned users before deleting
      const users = await db.User.findAll({
        include: {
          model: db.UserTeam,
          where: { projectId },
        },
      });

      await project.destroy();

      // Notify users
      const emailPromises = users.map((user) =>
        sendMail({
          to: user.email,
          subject: `Project Deleted: ${project.name}`,
          html: `
            <p>Hello ${user.firstName},</p>
            <p>The project <strong>${project.name}</strong> you were assigned to has been deleted.</p>
            <p>Thank you for your contribution.</p>
            <p>Best,<br>Team</p>
          `,
        })
      );

      await Promise.all(emailPromises);

      return res.status(200).json({ message: "Project deleted successfully" });
    } catch (err) {
      console.error("Delete project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        projectId: req.params.projectId,
        timestamp: new Date().toISOString(),
      });
      return res
        .status(500)
        .json({ message: "Failed to delete project", details: err.message });
    }
  },

  // Add client to project
  async addClientToProject(req, res) {
    try {
      const { projectId, clientId } = req.body;

      if (!projectId || !clientId) {
        return res
          .status(400)
          .json({ message: "Project ID and Client ID are required." });
      }

      const project = await Project.findByPk(projectId);
      const client = await Client.findByPk(clientId);

      if (!project) {
        return res.status(404).json({ message: "Project not found." });
      }
      if (!client) {
        return res.status(404).json({ message: "Client not found." });
      }

      // Create association
      await db.ClientProject.create({ projectId, clientId });

      return res
        .status(200)
        .json({ message: "Client added to project successfully." });
    } catch (err) {
      console.error("Add client to project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({
        message: "Failed to add client to project",
        details: err.message,
      });
    }
  },

  // Remove client from project
  async removeClientFromProject(req, res) {
    try {
      const { projectId, clientId } = req.params;

      const affectedRows = await db.ClientProject.destroy({
        where: { projectId, clientId },
      });

      if (affectedRows === 0) {
        return res.status(404).json({
          message: "No association found between this client and project.",
        });
      }

      return res
        .status(200)
        .json({ message: "Client removed from project successfully." });
    } catch (err) {
      console.error("Remove client from project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        role: req.user?.role,
        params: req.params,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({
        message: "Failed to remove client from project",
        details: err.message,
      });
    }
  },
};
