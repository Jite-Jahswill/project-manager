const db = require("../models");
const sendMail = require("../utils/mailer");
const { notifyClientOnProjectCompletion } = require("./client.controller");
const { User, Project, Task, UserTeam } = require("../models");

module.exports = {
  // Create a new project (Admin or Manager)
  async createProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only admins or managers can create projects" });
      }
      const { name, description, startDate, endDate, teamIds } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Project name is required" });
      }

      const transaction = await db.sequelize.transaction();

      try {
        const project = await db.Project.create(
          {
            name,
            description: description || null,
            startDate: startDate || null,
            endDate: endDate || null,
            status: "To Do",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { transaction }
        );

        // Assign multiple teams if teamIds is provided
        if (teamIds && Array.isArray(teamIds) && teamIds.length > 0) {
          const teams = await db.Team.findAll({
            where: { id: teamIds },
            transaction,
          });

          if (teams.length !== teamIds.length) {
            await transaction.rollback();
            return res.status(404).json({ message: "One or more teams not found" });
          }

          await db.TeamProject.bulkCreate(
            teamIds.map((teamId) => ({
              teamId: parseInt(teamId),
              projectId: project.id,
              createdAt: new Date(),
              updatedAt: new Date(),
            })),
            { transaction }
          );
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
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            teams: [], // Will be populated in get operations
            tasks: [],
            clients: [],
          },
        });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
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

  // Get project by ID (All authenticated users, restricted to assigned projects for staff)
  async getProjectById(req, res) {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
      }

      // Check if user is assigned to the project
      let isAssigned = false;
      if (req.user.role === "staff") {
        const userAssignment = await db.UserTeam.findOne({
          where: { userId: req.user.id, projectId: parseInt(projectId) },
        });
        isAssigned = !!userAssignment;
      } else if (["admin", "manager"].includes(req.user.role)) {
        isAssigned = true; // Admins and managers have unrestricted access
      } else {
        return res.status(403).json({ message: "Unauthorized role" });
      }

      if (!isAssigned) {
        return res.status(403).json({ message: "Unauthorized to view this project" });
      }

      const project = await db.Project.findByPk(projectId, {
        include: [
          {
            model: db.Team,
            as: "Teams", // Changed to plural to reflect many-to-many
            attributes: ["id", "name"],
            through: { attributes: [] },
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
            as: "Tasks",
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
          teams: project.Teams.map((team) => ({
            teamId: team.id,
            teamName: team.name,
            members: team.Users.map((user) => ({
              userId: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              phoneNumber: user.phoneNumber || null,
              role: user.UserTeam.role,
              note: user.UserTeam.note,
            })),
          })),
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
            as: "Teams", // Changed to plural
            attributes: ["id", "name"],
            through: { attributes: [] },
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
            as: "Tasks",
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
        teams: project.Teams.map((team) => ({
          teamId: team.id,
          teamName: team.name,
          members: team.Users.map((user) => ({
            userId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phoneNumber: user.phoneNumber || null,
            role: user.UserTeam.role,
            note: user.UserTeam.note,
          })),
        })),
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

  // Get all projects (All authenticated users, restricted to assigned projects for staff)
  async getAllProjects(req, res) {
  try {
    const { projectName, status, startDate, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    // Validate pagination parameters
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: "Invalid page or limit" });
    }

    const where = {};
    if (projectName) where.name = { [db.Sequelize.Op.like]: `%${projectName}%` };
    if (status) where.status = status;
    if (startDate) where.startDate = startDate;

    let projectIds = null;

    // Restrict projects based on user role
    if (req.user.role === "client") {
      const clientProjects = await db.ClientProject.findAll({
        where: { clientId: req.user.id },
        attributes: ["projectId"],
      });
      projectIds = clientProjects.map((cp) => cp.projectId);
      where.id = projectIds.length ? { [db.Sequelize.Op.in]: projectIds } : { [db.Sequelize.Op.in]: [0] }; // Handle empty case
    } else if (req.user.role === "staff") {
      const userTeams = await db.UserTeam.findAll({
        where: { userId: req.user.id, projectId: { [db.Sequelize.Op.ne]: null } },
        attributes: ["projectId"],
      });
      projectIds = userTeams.map((ut) => ut.projectId);
      where.id = projectIds.length ? { [db.Sequelize.Op.in]: projectIds } : { [db.Sequelize.Op.in]: [0] }; // Handle empty case
    } else if (!["admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ message: "Unauthorized role" });
    }

    // Get total count separately to ensure accuracy
    const count = await db.Project.count({ where });

    // Fetch projects with pagination
    const projects = await db.Project.findAll({
      where,
      include: [
        {
          model: db.Team,
          as: "Teams",
          attributes: ["id", "name"],
          through: { attributes: [] },
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
          as: "Tasks",
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

    // Map projects to response format
    const formattedProjects = projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      startDate: project.startDate,
      endDate: project.endDate,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      teams: project.Teams.map((team) => ({
        teamId: team.id,
        teamName: team.name,
        members: team.Users.map((user) => ({
          userId: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phoneNumber: user.phoneNumber || null,
          role: user.UserTeam.role,
          note: user.UserTeam.note,
        })),
      })),
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

    return res.status(200).json({ projects: formattedProjects, pagination });
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

  // Get all projects for a specific client (Admin, Manager, or Client themselves)
  async getClientProjects(req, res) {
    try {
      const { clientId } = req.params;
      const { projectName, status, startDate, page = 1, limit = 20 } = req.query;
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);

      if (!clientId) {
        return res.status(400).json({ message: "clientId is required" });
      }
      if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: "Invalid page or limit" });
      }

      // Check if client exists
      const client = await db.Client.findByPk(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      // Restrict access: only admins, managers, or the client themselves
      if (req.user.role === "client" && parseInt(clientId) !== req.user.id) {
        return res.status(403).json({ message: "Unauthorized to view this client's projects" });
      }
      if (!["admin", "manager", "client"].includes(req.user.role)) {
        return res.status(403).json({ message: "Unauthorized role" });
      }

      const where = {
        id: {
          [db.Sequelize.Op.in]: db.sequelize.literal(
            `(SELECT projectId FROM ClientProjects WHERE clientId = ${parseInt(clientId)})`
          ),
        },
      };
      if (projectName) where.name = { [db.Sequelize.Op.like]: `%${projectName}%` };
      if (status) where.status = status;
      if (startDate) where.startDate = startDate;

      const { count, rows } = await db.Project.findAndCountAll({
        where,
        include: [
          {
            model: db.Team,
            as: "Teams", // Changed to plural
            attributes: ["id", "name"],
            through: { attributes: [] },
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
            as: "Tasks",
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
        teams: project.Teams.map((team) => ({
          teamId: team.id,
          teamName: team.name,
          members: team.Users.map((user) => ({
            userId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phoneNumber: user.phoneNumber || null,
            role: user.UserTeam.role,
            note: user.UserTeam.note,
          })),
        })),
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
      console.error("Get client projects error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        clientId: req.params.clientId,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      return res.status(500).json({ message: "Failed to retrieve client projects", details: err.message });
    }
  },

  // Assign multiple teams to a project
  async assignTeamToProject(req, res) {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ message: "Only admins or managers can assign teams to projects" });
    }

    const { teamId, projectId } = req.body;
    if (!teamId || !projectId) {
      return res.status(400).json({ message: "teamId and projectId are required" });
    }

    // Convert single teamId to array for internal processing
    const teamIds = [parseInt(teamId)];

    // Validate project existence
    const project = await db.Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Validate team existence
    const teams = await db.Team.findAll({
      where: { id: teamIds },
    });
    if (teams.length !== teamIds.length) {
      return res.status(404).json({ message: "Team not found" });
    }

    // Check for existing associations
    const existingAssociations = await db.sequelize.query(
      `SELECT teamId FROM TeamProjects WHERE projectId = :projectId AND teamId IN (:teamIds)`,
      {
        replacements: { projectId: parseInt(projectId), teamIds },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );
    const existingTeamIds = existingAssociations.map((assoc) => assoc.teamId);
    const newTeamIds = teamIds.filter((id) => !existingTeamIds.includes(id));

    if (newTeamIds.length === 0) {
      return res.status(400).json({ message: "Team is already assigned to this project" });
    }

    // Insert new team assignment (raw MySQL query)
    const insertQuery = `
      INSERT INTO TeamProjects (teamId, projectId, createdAt, updatedAt)
      VALUES (?, ?, NOW(), NOW())
    `;
    await db.sequelize.query(insertQuery, {
      replacements: [newTeamIds[0], parseInt(projectId)],
      type: db.sequelize.QueryTypes.INSERT,
    });

    // Update UserTeams.projectId for team members (raw MySQL query)
    const teamMembers = await db.User.findAll({
      include: [
        {
          model: db.Team,
          where: { id: newTeamIds },
          attributes: ["id", "name"],
          through: { attributes: [] },
        },
      ],
      attributes: ["id", "email", "firstName", "lastName", "phoneNumber"],
    });

    if (teamMembers.length > 0) {
      const userTeamUpdateQuery = `
        UPDATE UserTeams 
        SET projectId = :projectId, updatedAt = NOW()
        WHERE teamId IN (:teamIds) AND projectId IS NULL
      `;
      await db.sequelize.query(userTeamUpdateQuery, {
        replacements: { projectId: parseInt(projectId), teamIds: newTeamIds },
        type: db.sequelize.QueryTypes.UPDATE,
      });
    }

    // Send emails
    const emailPromises = teamMembers.map((user) =>
      sendMail({
        to: user.email,
        subject: `Your Team Has Been Assigned to Project: ${project.name}`,
        html: `
          <p>Hello ${user.firstName},</p>
          <p>Your team has been assigned to the project <strong>${project.name}</strong>.</p>
          <p><strong>Start Date:</strong> ${project.startDate || "TBD"}</p>
          <p><strong>End Date:</strong> ${project.endDate || "TBD"}</p>
          <p><strong>Contact Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
          <p>Please log in to view your tasks.</p>
          <p>Best,<br>Team</p>
        `,
      }).catch((emailErr) => {
        console.error("Email sending error:", {
          message: emailErr.message,
          userId: user.id,
          email: user.email,
          timestamp: new Date().toISOString(),
        });
      })
    );

    await Promise.all(emailPromises);

    return res.status(200).json({
      message: `Team assigned to project "${project.name}" successfully`,
      teams: teams.map((team) => ({
        teamId: team.id,
        teamName: team.name,
        members: teamMembers
          .filter((user) => user.Teams && user.Teams.some((t) => t.id === team.id))
          .map((u) => ({
            userId: u.id,
            email: u.email,
            name: `${u.firstName} ${u.lastName}`,
            phoneNumber: u.phoneNumber || null,
          })),
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
    return res.status(500).json({ message: "Failed to assign team to project", details: err.message });
  }
},

  // Remove teams from a project
  async removeTeamFromProject(req, res) {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ message: "Only admins or managers can remove teams from projects" });
    }

    const { teamId, projectId } = req.body;
    if (!teamId || !projectId) {
      return res.status(400).json({ message: "teamId and projectId are required" });
    }

    // Convert single teamId to array for internal processing
    const teamIds = [parseInt(teamId)];

    // Validate project existence
    const project = await db.Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Validate team existence
    const teams = await db.Team.findAll({
      where: { id: teamIds },
    });
    if (teams.length !== teamIds.length) {
      return res.status(404).json({ message: "Team not found" });
    }

    // Check if team is assigned to the project
    const existingAssociations = await db.sequelize.query(
      `SELECT teamId FROM TeamProjects WHERE projectId = :projectId AND teamId IN (:teamIds)`,
      {
        replacements: { projectId: parseInt(projectId), teamIds },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );
    const assignedTeamIds = existingAssociations.map((assoc) => assoc.teamId);
    if (assignedTeamIds.length === 0) {
      return res.status(400).json({ message: "Team is not assigned to this project" });
    }

    // Remove team assignment (raw MySQL query)
    const deleteQuery = `
      DELETE FROM TeamProjects 
      WHERE projectId = :projectId AND teamId = :teamId
    `;
    await db.sequelize.query(deleteQuery, {
      replacements: { projectId: parseInt(projectId), teamId: assignedTeamIds[0] },
      type: db.sequelize.QueryTypes.DELETE,
    });

    // Update UserTeams.projectId for team members (raw MySQL query)
    const teamMembers = await db.User.findAll({
      include: [
        {
          model: db.Team,
          where: { id: assignedTeamIds },
          attributes: ["id", "name"],
          through: { attributes: [] },
        },
      ],
      attributes: ["id", "email", "firstName", "lastName", "phoneNumber"],
    });

    if (teamMembers.length > 0) {
      const userTeamUpdateQuery = `
        UPDATE UserTeams 
        SET projectId = NULL, updatedAt = NOW()
        WHERE teamId IN (:teamIds) AND projectId = :projectId
      `;
      await db.sequelize.query(userTeamUpdateQuery, {
        replacements: { teamIds: assignedTeamIds, projectId: parseInt(projectId) },
        type: db.sequelize.QueryTypes.UPDATE,
      });
    }

    // Send emails
    const emailPromises = teamMembers.map((user) =>
      sendMail({
        to: user.email,
        subject: `Your Team Has Been Removed from Project: ${project.name}`,
        html: `
          <p>Hello ${user.firstName},</p>
          <p>Your team has been removed from the project <strong>${project.name}</strong>.</p>
          <p><strong>Start Date:</strong> ${project.startDate || "TBD"}</p>
          <p><strong>End Date:</strong> ${project.endDate || "TBD"}</p>
          <p><strong>Contact Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
          <p>Please check your dashboard for updated assignments.</p>
          <p>Best,<br>Team</p>
        `,
      }).catch((emailErr) => {
        console.error("Email sending error:", {
          message: emailErr.message,
          userId: user.id,
          email: user.email,
          timestamp: new Date().toISOString(),
        });
      })
    );

    await Promise.all(emailPromises);

    return res.status(200).json({
      message: `Team removed from project "${project.name}" successfully`,
      teams: teams
        .filter((team) => assignedTeamIds.includes(team.id))
        .map((team) => ({
          teamId: team.id,
          teamName: team.name,
          members: teamMembers
            .filter((user) => user.Teams && user.Teams.some((t) => t.id === team.id))
            .map((u) => ({
              userId: u.id,
              email: u.email,
              name: `${u.firstName} ${u.lastName}`,
              phoneNumber: u.phoneNumber || null,
            })),
        })),
    });
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

      // Update project status using raw MySQL
      await db.sequelize.query(
        `UPDATE Projects SET status = :status, updatedAt = NOW() WHERE id = :projectId`,
        {
          replacements: { status, projectId: parseInt(projectId) },
          type: db.sequelize.QueryTypes.UPDATE,
        }
      );

      const updatedProject = await db.Project.findByPk(projectId, {
        include: [
          {
            model: db.Team,
            as: "Teams", // Changed to plural
            attributes: ["id", "name"],
            through: { attributes: [] },
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
            as: "Tasks",
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
          teams: updatedProject.Teams.map((team) => ({
            teamId: team.id,
            teamName: team.name,
            members: team.Users.map((user) => ({
              userId: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              phoneNumber: user.phoneNumber || null,
              role: user.UserTeam.role,
              note: user.UserTeam.note,
            })),
          })),
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

  // Update project (admin or manager)
  async updateProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({ message: "Only admins or managers can update projects" });
      }

      const { projectId } = req.params;
      const { name, description, startDate, endDate, status, teamIds } = req.body;

      const project = await db.Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      if (teamIds && Array.isArray(teamIds)) {
        const teams = await db.Team.findAll({ where: { id: teamIds } });
        if (teams.length !== teamIds.length) {
          return res.status(404).json({ message: "One or more teams not found" });
        }
      }

      // Validate status if provided
      if (status) {
        const validStatuses = ["To Do", "In Progress", "Review", "Done"];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ message: "Invalid status value" });
        }
      }

      // Check if at least one field is provided
      const hasUpdates = name || description !== undefined || startDate || endDate !== undefined || status || teamIds;
      if (!hasUpdates) {
        return res.status(400).json({ message: "At least one field must be provided for update" });
      }

      const transaction = await db.sequelize.transaction();

      try {
        // Update project details using raw MySQL
        const updates = {};
        let setClause = [];
        if (name) {
          setClause.push("name = :name");
          updates.name = name;
        }
        if (description !== undefined) {
          setClause.push("description = :description");
          updates.description = description || null;
        }
        if (startDate) {
          setClause.push("startDate = :startDate");
          updates.startDate = new Date(startDate).toISOString();
        }
        if (endDate !== undefined) {
          setClause.push("endDate = :endDate");
          updates.endDate = endDate ? new Date(endDate).toISOString() : null;
        }
        if (status) {
          setClause.push("status = :status");
          updates.status = status;
        }
        setClause.push("updatedAt = NOW()");

        if (setClause.length > 1 || (setClause.length === 1 && !setClause.includes("updatedAt = NOW()"))) {
          const query = `
            UPDATE Projects
            SET ${setClause.join(", ")}
            WHERE id = :projectId
          `;
          await db.sequelize.query(query, {
            replacements: { ...updates, projectId: parseInt(projectId) },
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          });
        }

        // Update team assignments if teamIds is provided
        if (teamIds && Array.isArray(teamIds)) {
          // Get current team assignments
          const currentTeamIds = (
            await db.sequelize.query(
              `SELECT teamId FROM TeamProjects WHERE projectId = :projectId`,
              {
                replacements: { projectId: parseInt(projectId) },
                type: db.sequelize.QueryTypes.SELECT,
                transaction,
              }
            )
          ).map((assoc) => assoc.teamId);

          // Determine teams to add and remove
          const teamsToAdd = teamIds.filter((id) => !currentTeamIds.includes(parseInt(id)));
          const teamsToRemove = currentTeamIds.filter((id) => !teamIds.includes(id));

          // Add new team assignments
          if (teamsToAdd.length > 0) {
            const insertQuery = `
              INSERT INTO TeamProjects (teamId, projectId, createdAt, updatedAt)
              VALUES ${teamsToAdd.map(() => "(?, ?, NOW(), NOW())").join(", ")}
            `;
            const replacements = teamsToAdd.flatMap((teamId) => [parseInt(teamId), parseInt(projectId)]);
            await db.sequelize.query(insertQuery, {
              replacements,
              type: db.sequelize.QueryTypes.INSERT,
              transaction,
            });
          }

          // Remove old team assignments
          if (teamsToRemove.length > 0) {
            const deleteQuery = `
              DELETE FROM TeamProjects 
              WHERE projectId = :projectId AND teamId IN (:teamIds)
            `;
            await db.sequelize.query(deleteQuery, {
              replacements: { projectId: parseInt(projectId), teamIds: teamsToRemove },
              type: db.sequelize.QueryTypes.DELETE,
              transaction,
            });
          }

          // Update UserTeams.projectId for team members
          const teamMembersToAdd = teamsToAdd.length
            ? await db.User.findAll({
                include: [
                  {
                    model: db.Team,
                    where: { id: teamsToAdd },
                    attributes: [],
                    through: { attributes: [] },
                  },
                ],
                attributes: ["id", "email", "firstName", "lastName", "phoneNumber"],
                transaction,
              })
            : [];

          if (teamMembersToAdd.length > 0) {
            const userTeamUpdateQuery = `
              UPDATE UserTeams 
              SET projectId = :projectId, updatedAt = NOW()
              WHERE teamId IN (:teamIds) AND projectId IS NULL
            `;
            await db.sequelize.query(userTeamUpdateQuery, {
              replacements: { projectId: parseInt(projectId), teamIds: teamsToAdd },
              type: db.sequelize.QueryTypes.UPDATE,
              transaction,
            });
          }

          const teamMembersToRemove = teamsToRemove.length
            ? await db.User.findAll({
                include: [
                  {
                    model: db.Team,
                    where: { id: teamsToRemove },
                    attributes: [],
                    through: { attributes: [] },
                  },
                ],
                attributes: ["id", "email", "firstName", "lastName", "phoneNumber"],
                transaction,
              })
            : [];

          if (teamMembersToRemove.length > 0) {
            const userTeamRemoveQuery = `
              UPDATE UserTeams 
              SET projectId = NULL, updatedAt = NOW()
              WHERE teamId IN (:teamIds) AND projectId = :projectId
            `;
            await db.sequelize.query(userTeamRemoveQuery, {
              replacements: { projectId: parseInt(projectId), teamIds: teamsToRemove },
              type: db.sequelize.QueryTypes.UPDATE,
              transaction,
            });
          }

          // Send emails to affected team members
          const emailPromises = [];
          teamMembersToAdd.forEach((user) =>
            emailPromises.push(
              sendMail({
                to: user.email,
                subject: `Project Updated: ${name || project.name}`,
                html: `
                  <p>Hello ${user.firstName},</p>
                  <p>Your team has been assigned to the project <strong>${name || project.name}</strong>.</p>
                  <p><strong>Start Date:</strong> ${startDate || project.startDate || "TBD"}</p>
                  <p><strong>End Date:</strong> ${endDate || project.endDate || "TBD"}</p>
                  <p><strong>Status:</strong> ${status || project.status}</p>
                  <p><strong>Contact Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
                  <p>Check your dashboard for details.</p>
                  <p>Best,<br>Team</p>
                `,
              })
            )
          );
          teamMembersToRemove.forEach((user) =>
            emailPromises.push(
              sendMail({
                to: user.email,
                subject: `Removed from Project: ${name || project.name}`,
                html: `
                  <p>Hello ${user.firstName},</p>
                  <p>Your team has been removed from the project <strong>${name || project.name}</strong>.</p>
                  <p><strong>Start Date:</strong> ${startDate || project.startDate || "TBD"}</p>
                  <p><strong>End Date:</strong> ${endDate || project.endDate || "TBD"}</p>
                  <p><strong>Status:</strong> ${status || project.status}</p>
                  <p><strong>Contact Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
                  <p>Check your dashboard for details.</p>
                  <p>Best,<br>Team</p>
                `,
              })
            )
          );
          await Promise.all(emailPromises);
        }

        await transaction.commit();

        const updatedProject = await db.Project.findByPk(projectId, {
          include: [
            {
              model: db.Team,
              as: "Teams",
              attributes: ["id", "name"],
              through: { attributes: [] },
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
              as: "Tasks",
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
            teams: updatedProject.Teams.map((team) => ({
              teamId: team.id,
              teamName: team.name,
              members: team.Users.map((user) => ({
                userId: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phoneNumber: user.phoneNumber || null,
                role: user.UserTeam.role,
                note: user.UserTeam.note,
              })),
            })),
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
        await transaction.rollback();
        throw err;
      }
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

        // Get all teams associated with the project
        const teamIds = (
          await db.sequelize.query(
            `SELECT teamId FROM TeamProjects WHERE projectId = :projectId`,
            {
              replacements: { projectId: parseInt(projectId) },
              type: db.sequelize.QueryTypes.SELECT,
              transaction,
            }
          )
        ).map((assoc) => assoc.teamId);

        const teamMembers = teamIds.length
          ? await db.User.findAll({
              include: [
                {
                  model: db.Team,
                  where: { id: teamIds },
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

        // Delete project (cascades to TeamProjects and UserTeams via onDelete: CASCADE)
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
        return res.status(400).json({ message: "Project ID and Client ID are required" });
      }

      const transaction = await db.sequelize.transaction();

      try {
        const project = await db.Project.findByPk(projectId, { transaction });
        if (!project) {
          await transaction.rollback();
          return res.status(404).json({ message: "Project not found" });
        }

        const client = await db.Client.findByPk(clientId, { transaction });
        if (!client) {
          await transaction.rollback();
          return res.status(404).json({ message: "Client not found" });
        }

        const existingAssociation = await db.ClientProject.findOne({
          where: { clientId, projectId },
          transaction,
        });
        if (existingAssociation) {
          await transaction.rollback();
          return res.status(400).json({ message: "Client is already associated with this project" });
        }

        await db.sequelize.query(
          `INSERT INTO ClientProjects (clientId, projectId, createdAt, updatedAt)
           VALUES (:clientId, :projectId, NOW(), NOW())`,
          {
            replacements: { clientId: parseInt(clientId), projectId: parseInt(projectId) },
            type: db.sequelize.QueryTypes.INSERT,
            transaction,
          }
        );

        await transaction.commit();
        return res.status(200).json({ message: "Client added to project successfully" });
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
        return res.status(400).json({ message: "Project ID and Client ID are required" });
      }

      const transaction = await db.sequelize.transaction();

      try {
        const project = await db.Project.findByPk(projectId, { transaction });
        if (!project) {
          await transaction.rollback();
          return res.status(404).json({ message: "Project not found" });
        }

        const association = await db.ClientProject.findOne({
          where: { clientId, projectId },
          transaction,
        });
        if (!association) {
          await transaction.rollback();
          return res.status(404).json({ message: "No association found between this client and project" });
        }

        await db.sequelize.query(
          `DELETE FROM ClientProjects WHERE clientId = :clientId AND projectId = :projectId`,
          {
            replacements: { clientId: parseInt(clientId), projectId: parseInt(projectId) },
            type: db.sequelize.QueryTypes.DELETE,
            transaction,
          }
        );

        await transaction.commit();
        return res.status(200).json({ message: "Client removed from project successfully" });
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

  // Get tasks for a specific project
async getTasksByProject(req, res) {
  try {
    const { projectId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
      return res.status(400).json({ message: "Invalid page or limit" });
    }

    if (!projectId) {
      return res.status(400).json({ message: "projectId is required" });
    }

    // Check if project exists
    const project = await Project.findByPk(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Authorization: Admins can view all tasks, non-admins must be part of a team assigned to the project
    if (req.user.role !== "admin") {
      const userTeam = await UserTeam.findOne({
        where: {
          userId: req.user.id,
          projectId,
        },
      });

      if (!userTeam) {
        return res.status(403).json({ message: "Unauthorized to view tasks for this project" });
      }
    }

    const { count, rows } = await Task.findAndCountAll({
      where: { projectId },
      include: [
        {
          model: Project,
          attributes: ["id", "name"],
        },
        {
          model: User,
          as: "assignee",
          attributes: ["id", "firstName", "lastName", "email"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: limitNum,
      offset: (pageNum - 1) * limitNum,
    });

    const tasks = rows.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      dueDate: task.dueDate,
      project: {
        id: task.Project.id,
        name: task.Project.name,
      },
      assignee: task.assignee
        ? {
            userId: task.assignee.id,
            firstName: task.assignee.firstName,
            lastName: task.assignee.lastName,
            email: task.assignee.email,
          }
        : null,
    }));

    const totalPages = Math.ceil(count / limitNum);

    res.status(200).json({
      tasks,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems: count,
        itemsPerPage: limitNum,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch project tasks", details: err.message });
  }
},
};
