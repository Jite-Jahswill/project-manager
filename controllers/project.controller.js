// controllers/project.controller.js
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
        status: "To Do",
      });
      return res
        .status(201)
        .json({ message: "Project created successfully", project });
    } catch (err) {
      console.error("Create project error:", err);
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
            text: `Hello ${
              user.firstName
            },\n\nYou've been assigned to the project "${
              project.name
            }" as a ${role}.\n\nStart Date: ${project.startDate}\nEnd Date: ${
              project.endDate || "TBD"
            }\n\nPlease log in to view your tasks.\n\nBest,\nTeam`,
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
      console.error("Assign team error:", err);
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
      if (!projectId)
        return res.status(400).json({ message: "projectId is required" });
      const project = await Project.findByPk(projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });
      const members = await UserTeam.findAll({
        where: { projectId },
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "email"] },
        ],
      });
      const formattedMembers = members.map((member) => ({
        userId: member.userId,
        firstName: member.User.firstName,
        lastName: member.User.lastName,
        email: member.User.email,
        role: member.role,
      }));
      return res.status(200).json({ members: formattedMembers });
    } catch (err) {
      console.error("Get members error:", err);
      return res.status(500).json({
        message: "Failed to retrieve project members",
        details: err.message,
      });
    }
  },

  // Get all projects (All authenticated users)

  async getAllProjects(req, res) {
    try {
      const { projectName, status, startDate } = req.query;
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

      const projects = await db.Project.findAll({
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
      });

      const formattedProjects = projects.map((project) => ({
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

      return res.status(200).json({ projects: formattedProjects });
    } catch (err) {
      console.error("Get projects error:", err);
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
      if (!status)
        return res.status(400).json({ message: "Status is required" });

      const project = await Project.findByPk(projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      const assigned = await UserTeam.findOne({
        where: { userId: req.user.id, projectId },
      });

      if (!assigned) {
        return res.status(403).json({
          message: "You're not assigned to this project",
        });
      }

      project.status = status;
      await project.save();

      // Notify all assigned users, admins, and managers
      const allUsers = await User.findAll({
        include: {
          model: UserTeam,
          where: { projectId },
        },
      });

      const adminsAndManagers = await User.findAll({
        where: {
          role: ["admin", "manager"],
        },
      });

      const uniqueEmails = new Set([
        ...allUsers.map((u) => u.email),
        ...adminsAndManagers.map((u) => u.email),
      ]);

      for (const email of uniqueEmails) {
        await sendMail({
          to: email,
          subject: `Project Status Updated: ${project.name}`,
          text: `Hello,\n\nThe status of project "${project.name}" has been updated to "${status}".\n\nBest regards,\nTeam`,
        });
      }

      // Notify the client if the project is marked as completed
      if (status.toLowerCase() === "completed") {
        await notifyClientOnProjectCompletion(projectId);
      }

      return res.status(200).json({
        message: "Status updated successfully",
        project,
      });
    } catch (err) {
      console.error("Update status error:", err);
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
      const { name, description, startDate, endDate, status, teamId } =
        req.body;

      const project = await Project.findByPk(projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      // Update basic fields
      if (name) project.name = name;
      if (description) project.description = description;
      if (startDate) project.startDate = startDate;
      if (endDate) project.endDate = endDate;
      if (status) project.status = status;
      if (teamId) project.teamId = teamId;

      await project.save();

      // Assign team to project
      if (teamId) {
        const team = await Team.findByPk(teamId, {
          include: [{ model: User }],
        });
        if (!team) return res.status(404).json({ message: "Team not found" });

        // Clear existing UserTeam entries for this project
        await UserTeam.destroy({ where: { projectId } });

        // Assign each team member to the project
        const userAssignments = team.Users.map((user) =>
          UserTeam.create({
            userId: user.id,
            projectId,
            role: "Developer", // default role
          })
        );

        await Promise.all(userAssignments);

        // Notify users
        for (const user of team.Users) {
          await sendMail({
            to: user.email,
            subject: `Project Updated: ${project.name}`,
            text: `Hello ${user.firstName},\n\nYou’ve been assigned to the updated project "${project.name}".\n\nCheck your dashboard for details.\n\nBest,\nTeam`,
          });
        }
      }

      return res.status(200).json({ message: "Project updated", project });
    } catch (err) {
      console.error("Update project error:", err);
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

      const project = await Project.findByPk(projectId);
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      // Fetch assigned users before deleting
      const users = await User.findAll({
        include: {
          model: UserTeam,
          where: { projectId },
        },
      });

      await project.destroy();

      for (const user of users) {
        await sendMail({
          to: user.email,
          subject: `Project Deleted: ${project.name}`,
          text: `Hello ${user.firstName},\n\nThe project "${project.name}" you were assigned to has been deleted.\n\nThank you for your contribution.\n\nBest,\nTeam`,
        });
      }

      return res.status(200).json({ message: "Project deleted successfully" });
    } catch (err) {
      console.error("Delete project error:", err);
      return res
        .status(500)
        .json({ message: "Failed to delete project", details: err.message });
    }
  },

  // controllers/project.controller.js

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
      console.error("Add client to project error:", err);
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
      console.error("Remove client from project error:", err);
      return res.status(500).json({
        message: "Failed to remove client from project",
        details: err.message,
      });
    }
  },
};
exports.updateProjectStatus = async (req, res) => {
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

    project.status = status;
    await project.save();

    // Notify all assigned users, admins, and managers
    const allUsers = await db.User.findAll({
      include: {
        model: db.UserTeam,
        where: { projectId },
      },
    });

    const adminsAndManagers = await db.User.findAll({
      where: {
        role: { [Op.in]: ["admin", "manager"] },
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

    return res.status(200).json({
      message: "Status updated successfully",
      project,
    });
  } catch (err) {
    console.error("Update status error:", {
      message: err.message,
      stack: err.stack,
      userId: req.user?.id,
      role: req.user?.role,
      projectId: req.params.projectId,
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({
      message: "Failed to update status",
      details: err.message,
    });
  }
};

exports.updateProject = async (req, res) => {
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

    // Update basic fields
    if (name) project.name = name;
    if (description) project.description = description;
    if (startDate) project.startDate = startDate;
    if (endDate) project.endDate = endDate;
    if (status) project.status = status;
    if (teamId) project.teamId = teamId;

    await project.save();

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

    return res.status(200).json({ message: "Project updated", project });
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
};

exports.deleteProject = async (req, res) => {
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
};
