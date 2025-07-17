const { Sequelize } = require("sequelize");
const db = require("../models");
const Project = db.Project;
const User = db.User;
const UserTeam = db.UserTeam;
const TeamProject = db.TeamProject;
const Team = db.Team;
const Client = db.Client;
const Task = db.Task;
const sendMail = require("../utils/mailer");
const { notifyClientOnProjectCompletion } = require("./client.controller");

module.exports = {
  async createProject(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        await transaction.rollback();
        return res
          .status(403)
          .json({ message: "Only admins or managers can create projects." });
      }
      const { name, description, startDate, endDate, teamId } = req.body;
      if (!name) {
        await transaction.rollback();
        return res.status(400).json({ message: "Project name is required" });
      }

      const project = await Project.create(
        {
          name,
          description,
          startDate,
          endDate,
          status: "Pending",
        },
        { transaction }
      );

      let assignedTeam = null;
      if (teamId) {
        const team = await Team.findByPk(teamId, {
          include: [{ model: User }],
          transaction,
        });
        if (!team) {
          await transaction.rollback();
          return res.status(404).json({ message: "Team not found" });
        }

        await TeamProject.create(
          { teamId, projectId: project.id, note: "Assigned during project creation" },
          { transaction }
        );

        const userAssignments = team.Users.map((user) =>
          UserTeam.create(
            {
              userId: user.id,
              projectId: project.id,
              teamId,
              role: "Developer",
              note: "Assigned via team",
            },
            { transaction }
          )
        );
        await Promise.all(userAssignments);

        const emailPromises = team.Users.map((user) =>
          sendMail({
            to: user.email,
            subject: `Assigned to New Project: ${project.name}`,
            html: `
              <p>Hello ${user.firstName},</p>
              <p>You've been assigned to the project <strong>${project.name}</strong> as a Developer via team <strong>${team.name}</strong>.</p>
              <p>Start Date: ${project.startDate || "TBD"}</p>
              <p>End Date: ${project.endDate || "TBD"}</p>
              <p>Check your dashboard for details.</p>
              <p>Best,<br>Team</p>
            `,
          })
        );
        await Promise.all(emailPromises);

        assignedTeam = {
          teamId: team.id,
          name: team.name,
          description: team.description,
          members: team.Users.map((user) => ({
            userId: user.id,
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            role: "Developer",
          })),
        };
      }

      await transaction.commit();
      return res.status(201).json({
        message: "Project created successfully",
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          startDate: project.startDate,
          endDate: project.endDate,
          status: project.status,
          teams: assignedTeam ? [assignedTeam] : [],
          tasks: [],
        },
      });
    } catch (err) {
      await transaction.rollback();
      return res
        .status(500)
        .json({ message: "Failed to create project", details: err.message });
    }
  },

  async assignTeamToProject(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        await transaction.rollback();
        return res.status(403).json({
          message: "Only admins or managers can assign teams to projects.",
        });
      }

      const { teamId, projectId, note, role = "Developer" } = req.body;

      if (!teamId || !projectId) {
        await transaction.rollback();
        return res.status(400).json({
          message: "teamId and projectId are required",
        });
      }

      const team = await Team.findByPk(teamId, {
        include: [{ model: User }],
        transaction,
      });
      const project = await Project.findByPk(projectId, { transaction });

      if (!team) {
        await transaction.rollback();
        return res.status(404).json({ message: "Team not found" });
      }
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ message: "Project not found" });
      }

      const existing = await TeamProject.findOne({
        where: { teamId, projectId },
        transaction,
      });
      if (existing) {
        await transaction.rollback();
        return res.status(400).json({ message: "Team already assigned to project" });
      }

      await TeamProject.create({ teamId, projectId, note }, { transaction });

      const userAssignments = team.Users.map((user) =>
        UserTeam.upsert(
          {
            userId: user.id,
            projectId,
            teamId,
            role,
            note: note || "Assigned via team",
          },
          { transaction }
        )
      );
      await Promise.all(userAssignments);

      const tasks = await Task.findAll({
        where: { projectId },
        attributes: ["id", "title", "status", "dueDate"],
        include: [
          {
            model: User,
            as: "assignee",
            attributes: ["id", "firstName", "lastName"],
            required: false,
          },
        ],
        transaction,
      });

      const emailPromises = team.Users.map((user) =>
        sendMail({
          to: user.email,
          subject: `Assigned to Project: ${project.name}`,
          html: `
            <p>Hello ${user.firstName},</p>
            <p>You've been assigned to the project <strong>${project.name}</strong> as a <strong>${role}</strong> via team <strong>${team.name}</strong>.</p>
            <p>Start Date: ${project.startDate || "TBD"}</p>
            <p>End Date: ${project.endDate || "TBD"}</p>
            <p>Check your dashboard for details.</p>
            <p>Best,<br>Team</p>
          `,
        })
      );
      await Promise.all(emailPromises);

      await transaction.commit();
      return res.status(200).json({
        message: "Team assigned to project successfully",
        team: {
          teamId: team.id,
          name: team.name,
          description: team.description,
          members: team.Users.map((user) => ({
            userId: user.id,
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            role,
            tasks: tasks
              .filter((task) => task.assignee && task.assignee.id === user.id)
              .map((task) => ({
                id: task.id,
                title: task.title,
                status: task.status,
                dueDate: task.dueDate,
              })),
          })),
        },
        project: {
          id: project.id,
          name: project.name,
        },
      });
    } catch (err) {
      await transaction.rollback();
      return res.status(500).json({
        message: "Failed to assign team to project",
        details: err.message,
      });
    }
  },

  async getProjectMembers(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      const { projectId } = req.params;
      if (!projectId) {
        await transaction.rollback();
        return res.status(400).json({ message: "projectId is required" });
      }

      const project = await Project.findByPk(projectId, {
        include: [
          {
            model: Team,
            through: { model: TeamProject, attributes: ["note"] },
            attributes: ["id", "name", "description"],
          },
        ],
        transaction,
      });

      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ message: "Project not found" });
      }

      const teams = await Team.findAll({
        include: [
          {
            model: Project,
            where: { id: projectId },
            through: { model: TeamProject, attributes: ["note"] },
            attributes: [],
          },
          {
            model: User,
            through: { model: UserTeam, attributes: ["role", "note"], where: { projectId } },
            attributes: ["id", "firstName", "lastName", "email"],
            include: [
              {
                model: Task,
                where: { projectId, assignedTo: db.Sequelize.col("User.id") },
                required: false,
                attributes: ["id", "title", "status", "dueDate"],
                as: "tasks",
              },
            ],
          },
        ],
        transaction,
      });

      const tasks = await Task.findAll({
        where: { projectId },
        attributes: ["id", "title", "status", "dueDate"],
        include: [
          {
            model: User,
            as: "assignee",
            attributes: ["id", "firstName", "lastName"],
            required: false,
          },
        ],
        transaction,
      });

      const formattedTeams = teams.map((team) => ({
        teamId: team.id,
        name: team.name,
        description: team.description,
        note: team.TeamProjects[0]?.note,
        members: team.Users.map((user) => ({
          userId: user.id,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          role: user.UserTeam.role,
          note: user.UserTeam.note,
          tasks: user.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            dueDate: task.dueDate,
          })),
        })),
      }));

      await transaction.commit();
      return res.status(200).json({
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
        },
        teams: formattedTeams,
        tasks: tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          dueDate: task.dueDate,
          assignee: task.assignee
            ? {
                id: task.assignee.id,
                name: `${task.assignee.firstName} ${task.assignee.lastName}`,
              }
            : null,
        })),
      });
    } catch (err) {
      await transaction.rollback();
      return res.status(500).json({
        message: "Failed to retrieve project members",
        details: err.message,
      });
    }
  },

  async getAllProjects(req, res) {
    const transaction = await db.sequelize.transaction();
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
      const { count, rows } = await Project.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: Client,
            through: { model: db.ClientProject, attributes: [] },
            attributes: ["id", "firstName", "lastName", "email", "image"],
          },
          {
            model: Team,
            through: { model: TeamProject, attributes: ["note"] },
            attributes: ["id", "name", "description"],
            include: [
              {
                model: User,
                through: { model: UserTeam, attributes: ["role", "note"], where: { projectId: db.Sequelize.col("Project.id") } },
                attributes: ["id", "firstName", "lastName", "email"],
                include: [
                  {
                    model: Task,
                    where: { projectId: db.Sequelize.col("Project.id"), assignedTo: db.Sequelize.col("User.id") },
                    required: false,
                    attributes: ["id", "title", "status", "dueDate"],
                    as: "tasks",
                  },
                ],
              },
            ],
          },
          {
            model: Task,
            attributes: ["id", "title", "status", "dueDate"],
            include: [
              {
                model: User,
                as: "assignee",
                attributes: ["id", "firstName", "lastName"],
                required: false,
              },
            ],
          },
        ],
        limit: parseInt(limit),
        offset,
        transaction,
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
        teams: project.Teams.map((team) => ({
          teamId: team.id,
          name: team.name,
          description: team.description,
          note: team.TeamProjects[0]?.note,
          members: team.Users.map((user) => ({
            userId: user.id,
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            role: user.UserTeam.role,
            note: user.UserTeam.note,
            tasks: user.tasks.map((task) => ({
              id: task.id,
              title: task.title,
              status: task.status,
              dueDate: task.dueDate,
            })),
          })),
        })),
        tasks: project.Tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          dueDate: task.dueDate,
          assignee: task.assignee
            ? {
                id: task.assignee.id,
                name: `${task.assignee.firstName} ${task.assignee.lastName}`,
              }
            : null,
        })),
      }));

      await transaction.commit();
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
      await transaction.rollback();
      return res.status(500).json({
        message: "Failed to retrieve projects",
        details: err.message,
      });
    }
  },

  async updateProjectStatus(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      const { projectId } = req.params;
      const { status } = req.body;
      if (!status) {
        await transaction.rollback();
        return res.status(400).json({ message: "Status is required" });
      }

      const project = await Project.findByPk(projectId, { transaction });
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ message: "Project not found" });
      }

      const assigned = await UserTeam.findOne({
        where: { userId: req.user.id, projectId },
        transaction,
      });
      if (!assigned) {
        await transaction.rollback();
        return res.status(403).json({
          message: "You're not assigned to this project",
        });
      }

      await project.update({ status }, { transaction });

      const allUsers = await User.findAll({
        include: {
          model: UserTeam,
          where: { projectId },
        },
        transaction,
      });

      const adminsAndManagers = await User.findAll({
        where: {
          role: { [db.Sequelize.Op.in]: ["admin", "manager"] },
        },
        transaction,
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

      if (status.toLowerCase() === "done") {
        await notifyClientOnProjectCompletion(projectId);
      }

      await transaction.commit();
      return res.status(200).json({
        message: "Status updated successfully",
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          startDate: project.startDate,
          endDate: project.endDate,
          status: project.status,
        },
      });
    } catch (err) {
      await transaction.rollback();
      return res.status(500).json({
        message: "Failed to update status",
        details: err.message,
      });
    }
  },

  async updateProject(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        await transaction.rollback();
        return res
          .status(403)
          .json({ message: "Only admins or managers can update projects." });
      }

      const { projectId } = req.params;
      const { name, description, startDate, endDate, status, teamId, note } = req.body;

      const project = await Project.findByPk(projectId, { transaction });
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ message: "Project not found" });
      }

      await project.update(
        {
          name: name || project.name,
          description: description || project.description,
          startDate: startDate || project.startDate,
          endDate: endDate || project.endDate,
          status: status || project.status,
        },
        { transaction }
      );

      if (teamId) {
        const team = await Team.findByPk(teamId, {
          include: [{ model: User }],
          transaction,
        });
        if (!team) {
          await transaction.rollback();
          return res.status(404).json({ message: "Team not found" });
        }

        const existing = await TeamProject.findOne({
          where: { teamId, projectId },
          transaction,
        });
        if (!existing) {
          await TeamProject.create({ teamId, projectId, note }, { transaction });

          await UserTeam.destroy({ where: { projectId }, transaction });

          const userAssignments = team.Users.map((user) =>
            UserTeam.create(
              {
                userId: user.id,
                projectId,
                teamId,
                role: "Developer",
                note: note || "Assigned via team update",
              },
              { transaction }
            )
          );
          await Promise.all(userAssignments);

          const emailPromises = team.Users.map((user) =>
            sendMail({
              to: user.email,
              subject: `Project Updated: ${project.name}`,
              html: `
                <p>Hello ${user.firstName},</p>
                <p>You've been assigned to the updated project <strong>${project.name}</strong> as a Developer via team <strong>${team.name}</strong>.</p>
                <p>Check your dashboard for details.</p>
                <p>Best,<br>Team</p>
              `,
            })
          );
          await Promise.all(emailPromises);
        }
      }

      const tasks = await Task.findAll({
        where: { projectId },
        attributes: ["id", "title", "status", "dueDate"],
        include: [
          {
            model: User,
            as: "assignee",
            attributes: ["id", "firstName", "lastName"],
            required: false,
          },
        ],
        transaction,
      });

      const teams = await Team.findAll({
        include: [
          {
            model: Project,
            where: { id: projectId },
            through: { model: TeamProject, attributes: ["note"] },
            attributes: [],
          },
          {
            model: User,
            through: { model: UserTeam, attributes: ["role", "note"], where: { projectId } },
            attributes: ["id", "firstName", "lastName", "email"],
            include: [
              {
                model: Task,
                where: { projectId, assignedTo: db.Sequelize.col("User.id") },
                required: false,
                attributes: ["id", "title", "status", "dueDate"],
                as: "tasks",
              },
            ],
          },
        ],
        transaction,
      });

      await transaction.commit();
      return res.status(200).json({
        message: "Project updated",
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          startDate: project.startDate,
          endDate: project.endDate,
          status: project.status,
          teams: teams.map((team) => ({
            teamId: team.id,
            name: team.name,
            description: team.description,
            note: team.TeamProjects[0]?.note,
            members: team.Users.map((user) => ({
              userId: user.id,
              name: `${user.firstName} ${user.lastName}`,
              email: user.email,
              role: user.UserTeam.role,
              note: user.UserTeam.note,
              tasks: user.tasks.map((task) => ({
                id: task.id,
                title: task.title,
                status: task.status,
                dueDate: task.dueDate,
              })),
            })),
          })),
          tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            dueDate: task.dueDate,
            assignee: task.assignee
              ? {
                  id: task.assignee.id,
                  name: `${task.assignee.firstName} ${task.assignee.lastName}`,
                }
              : null,
          })),
        },
      });
    } catch (err) {
      await transaction.rollback();
      return res
        .status(500)
        .json({ message: "Failed to update project", details: err.message });
    }
  },

  async deleteProject(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        await transaction.rollback();
        return res
          .status(403)
          .json({ message: "Only admins or managers can delete projects." });
      }

      const { projectId } = req.params;

      const project = await Project.findByPk(projectId, { transaction });
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ message: "Project not found" });
      }

      const users = await User.findAll({
        include: {
          model: UserTeam,
          where: { projectId },
        },
        transaction,
      });

      await project.destroy({ transaction });

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

      await transaction.commit();
      return res.status(200).json({ message: "Project deleted successfully" });
    } catch (err) {
      await transaction.rollback();
      return res
        .status(500)
        .json({ message: "Failed to delete project", details: err.message });
    }
  },

  async addClientToProject(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      const { projectId, clientId } = req.body;

      if (!projectId || !clientId) {
        await transaction.rollback();
        return res
          .status(400)
          .json({ message: "Project ID and Client ID are required." });
      }

      const project = await Project.findByPk(projectId, { transaction });
      const client = await Client.findByPk(clientId, { transaction });

      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ message: "Project not found." });
      }
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ message: "Client not found." });
      }

      await db.ClientProject.create({ projectId, clientId }, { transaction });

      await transaction.commit();
      return res
        .status(200)
        .json({ message: "Client added to project successfully." });
    } catch (err) {
      await transaction.rollback();
      return res.status(500).json({
        message: "Failed to add client to project",
        details: err.message,
      });
    }
  },

  async removeClientFromProject(req, res) {
    const transaction = await db.sequelize.transaction();
    try {
      const { projectId, clientId } = req.params;

      const affectedRows = await db.ClientProject.destroy({
        where: { projectId, clientId },
        transaction,
      });

      if (affectedRows === 0) {
        await transaction.rollback();
        return res.status(404).json({
          message: "No association found between this client and project.",
        });
      }

      await transaction.commit();
      return res
        .status(200)
        .json({ message: "Client removed from project successfully." });
    } catch (err) {
      await transaction.rollback();
      return res.status(500).json({
        message: "Failed to remove client from project",
        details: err.message,
      });
    }
  },
};
