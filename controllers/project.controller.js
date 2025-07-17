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

    const { teamId, projectId, note } = req.body;

    if (!teamId || !projectId) {
      return res.status(400).json({
        message: "teamId and projectId are required",
      });
    }

    const team = await db.Team.findByPk(teamId);
    const project = await db.Project.findByPk(projectId);

    if (!team) return res.status(404).json({ message: "Team not found" });
    if (!project) return res.status(404).json({ message: "Project not found" });

    // Check if already linked
    const existing = await db.TeamProject.findOne({
      where: { teamId, projectId },
    });

    if (existing) {
      return res.status(400).json({ message: "Team already assigned to project" });
    }

    // Create the link
    await db.TeamProject.create({ teamId, projectId, note });

    return res.status(200).json({
      message: "Team assigned to project successfully.",
      team: { id: team.id, name: team.name },
      project: { id: project.id, name: project.name },
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

    const project = await Project.findByPk(projectId, {
      include: [
        {
          model: Team,
          through: { attributes: [] },
          attributes: ["id", "name", "description"],
        },
      ],
    });

    if (!project)
      return res.status(404).json({ message: "Project not found" });

    const teams = await Team.findAll({
      include: [
        {
          model: Project,
          where: { id: projectId },
          through: { attributes: [] },
        },
        {
          model: User,
          through: { attributes: ["role", "projectId"] },
          attributes: ["id", "firstName", "lastName", "email"],
          include: [
            {
              model: Task,
              where: { projectId },
              required: false,
              attributes: ["id", "title", "status"],
            },
          ],
        },
      ],
    });

    const formattedTeams = teams.map((team) => ({
      teamId: team.id,
      name: team.name,
      description: team.description,
      members: team.Users.map((user) => ({
        userId: user.id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
        role: user.UserTeam.role,
        tasks: user.Tasks?.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
        })) || [],
      })),
    }));

    return res.status(200).json({
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
      },
      teams: formattedTeams,
    });
  } catch (err) {
    console.error("Get members error:", {
      message: err.message,
      stack: err.stack,
      projectId: req.params.projectId,
      userId: req.user?.id,
    });
    return res.status(500).json({
      message: "Failed to retrieve project members",
      details: err.message,
    });
  }
},
  
async getAllProjects(req, res) {
  try {
    const { projectName, status, startDate, page = 1, limit = 20 } = req.query;
    const whereClause = {};

    if (projectName) {
      whereClause.name = {
        [db.Sequelize.Op.like]: `%${projectName}%`,
      };
    }

    if (status) whereClause.status = status;
    if (startDate) whereClause.startDate = startDate;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { count, rows: projects } = await db.Project.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: db.Client,
          through: { attributes: [] }, // ✅ Correct `through` usage
          attributes: ["id", "firstName", "lastName", "email", "image"],
        },
        {
          model: db.Team,
          through: { attributes: [] }, // ✅ Correct `through` usage
          attributes: ["id", "name", "description"],
        },
      ],
      limit: parseInt(limit),
      offset,
    });

    const formattedProjects = await Promise.all(
      projects.map(async (project) => {
        // Fetch all Teams related to this project with their users and tasks
        const teams = await db.Team.findAll({
          include: [
            {
              model: db.Project,
              where: { id: project.id },
              through: { attributes: [] }, // ✅ Fix here too
            },
            {
              model: db.User,
              through: {
                attributes: ["role", "projectId"],
              },
              attributes: ["id", "firstName", "lastName", "email"],
              include: [
                {
                  model: db.Task,
                  where: { projectId: project.id },
                  required: false,
                  attributes: ["id", "title", "status"],
                },
              ],
            },
          ],
        });

        const formattedTeams = teams.map((team) => ({
          teamId: team.id,
          name: team.name,
          description: team.description,
          members: team.Users.map((user) => ({
            userId: user.id,
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            role: user.UserTeam?.role || "Member",
            tasks: user.Tasks?.map((task) => ({
              id: task.id,
              title: task.title,
              status: task.status,
            })) || [],
          })),
        }));

        return {
          id: project.id,
          name: project.name,
          description: project.description,
          startDate: project.startDate,
          endDate: project.endDate,
          status: project.status,
          client: project.Clients?.[0]
            ? {
                id: project.Clients[0].id,
                firstName: project.Clients[0].firstName,
                lastName: project.Clients[0].lastName,
                email: project.Clients[0].email,
                image: project.Clients[0].image,
              }
            : null,
          teams: formattedTeams,
        };
      })
    );

    return res.status(200).json({
      projects: formattedProjects,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Get all projects error:", {
      message: err.message,
      stack: err.stack,
      query: req.query,
      userId: req.user?.id,
    });
    return res.status(500).json({
      message: "Failed to retrieve projects",
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
