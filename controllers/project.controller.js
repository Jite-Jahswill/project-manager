const db = require("../models");
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

      // Create project using Sequelize
      const project = await db.Project.create({
        name,
        description: description || null,
        startDate: startDate || null,
        endDate: endDate || null,
        status: "To Do",
        createdAt: new Date(),
        updatedAt: new Date(),
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

      const { teamId, projectId } = req.body;
      if (!teamId || !projectId) {
        return res.status(400).json({
          message: "teamId and projectId are required",
        });
      }

      // Start a transaction to ensure atomicity
      const transaction = await db.sequelize.transaction();

      try {
        // Check if team exists
        const [team] = await db.sequelize.query(
          `SELECT id, name FROM Teams WHERE id = :teamId`,
          {
            replacements: { teamId },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          }
        );
        if (!team) {
          await transaction.rollback();
          return res.status(404).json({ message: "Team not found" });
        }

        // Check if project exists
        const [project] = await db.sequelize.query(
          `SELECT id, name, startDate, endDate FROM Projects WHERE id = :projectId`,
          {
            replacements: { projectId },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          }
        );
        if (!project) {
          await transaction.rollback();
          return res.status(404).json({ message: "Project not found" });
        }

        // Fetch team members
        const teamMembers = await db.sequelize.query(
          `
          SELECT u.id, u.email, u.firstName, u.lastName, u.phoneNumber
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

        // Update project with teamId
        await db.sequelize.query(
          `UPDATE Projects SET teamId = :teamId, updatedAt = NOW() WHERE id = :projectId`,
          {
            replacements: { teamId, projectId },
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          }
        );

        // Notify team members
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
          message: `Team "${team.name}" assigned to project successfully.`,
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
      if (err.message.includes("prepare statement needs to be reprepared")) {
        return res.status(500).json({
          message: "Database connection issue occurred",
          details: "Please try again or contact support if the issue persists",
        });
      }
      return res.status(500).json({
        message: "Failed to assign team to project",
        details: err.message,
      });
    }
  },

  // Remove a team from a project
  async removeTeamFromProject(req, res) {
    try {
      if (!["admin", "manager"].includes(req.user.role)) {
        return res.status(403).json({
          message: "Only admins or managers can remove teams from projects.",
        });
      }

      const { teamId, projectId } = req.body;
      if (!teamId || !projectId) {
        return res.status(400).json({
          message: "teamId and projectId are required",
        });
      }

      // Start a transaction to ensure atomicity
      const transaction = await db.sequelize.transaction();

      try {
        // Check if team exists
        const [team] = await db.sequelize.query(
          `SELECT id, name FROM Teams WHERE id = :teamId`,
          {
            replacements: { teamId },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          }
        );
        if (!team) {
          await transaction.rollback();
          return res.status(404).json({ message: "Team not found" });
        }

        // Check if project exists and is assigned to the team
        const [project] = await db.sequelize.query(
          `SELECT id, name, startDate, endDate, teamId FROM Projects WHERE id = :projectId`,
          {
            replacements: { projectId },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          }
        );
        if (!project) {
          await transaction.rollback();
          return res.status(404).json({ message: "Project not found" });
        }
        if (project.teamId !== parseInt(teamId)) {
          await transaction.rollback();
          return res.status(400).json({ message: "Team is not assigned to this project" });
        }

        // Fetch team members
        const teamMembers = await db.sequelize.query(
          `
          SELECT u.id, u.email, u.firstName, u.lastName, u.phoneNumber
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

        // Remove team from project by setting teamId to NULL
        await db.sequelize.query(
          `UPDATE Projects SET teamId = NULL, updatedAt = NOW() WHERE id = :projectId`,
          {
            replacements: { projectId },
            type: db.sequelize.QueryTypes.UPDATE,
            transaction,
          }
        );

        // Notify team members
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
          message: `Team "${team.name}" removed from project successfully.`,
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
      if (err.message.includes("prepare statement needs to be reprepared")) {
        return res.status(500).json({
          message: "Database connection issue occurred",
          details: "Please try again or contact support if the issue persists",
        });
      }
      return res.status(500).json({
        message: "Failed to remove team from project",
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

      const [project] = await db.sequelize.query(
        `SELECT id FROM Projects WHERE id = :projectId`,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      const members = await db.sequelize.query(
        `
        SELECT u.id AS userId, u.firstName, u.lastName, u.email, u.phoneNumber, ut.role
        FROM Users u
        INNER JOIN UserTeams ut ON u.id = ut.userId
        WHERE ut.projectId = :projectId
        `,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      return res.status(200).json({ members });
    } catch (err) {
      console.error("Get members error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        projectId: req.params.projectId,
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

      // Validate page and limit
      const pageNum = parseInt(page, 10);
      const limitNum = parseInt(limit, 10);
      if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({ message: "Invalid page or limit" });
      }

      // Build query
      let query = `
        SELECT p.id, p.name, p.description, p.startDate, p.endDate, p.status, p.teamId,
               c.id AS clientId, c.firstName AS clientFirstName, c.lastName AS clientLastName, c.email AS clientEmail, c.image AS clientImage,
               t.id AS teamId, t.name AS teamName
        FROM Projects p
        LEFT JOIN ClientProjects cp ON p.id = cp.projectId
        LEFT JOIN Clients c ON cp.clientId = c.id
        LEFT JOIN Teams t ON p.teamId = t.id
      `;
      const replacements = {};

      let whereClauses = [];
      if (projectName) {
        whereClauses.push(`p.name LIKE :projectName`);
        replacements.projectName = `%${projectName}%`;
      }
      if (status) {
        whereClauses.push(`p.status = :status`);
        replacements.status = status;
      }
      if (startDate) {
        whereClauses.push(`DATE(p.startDate) = :startDate`);
        replacements.startDate = startDate;
      }

      if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(" AND ")}`;
      }

      // Add pagination
      const offset = (pageNum - 1) * limitNum;
      query += ` LIMIT :limit OFFSET :offset`;
      replacements.limit = limitNum;
      replacements.offset = offset;

      // Fetch projects
      const projects = await db.sequelize.query(query, {
        replacements,
        type: db.sequelize.QueryTypes.SELECT,
      });

      // Fetch total count for pagination
      let countQuery = `SELECT COUNT(*) as total FROM Projects`;
      const countReplacements = {};
      if (whereClauses.length > 0) {
        countQuery += ` WHERE ${whereClauses.join(" AND ")}`;
        Object.assign(countReplacements, replacements);
      }

      const [{ total }] = await db.sequelize.query(countQuery, {
        replacements: countReplacements,
        type: db.sequelize.QueryTypes.SELECT,
      });

      // Fetch team members and tasks for each project
      const formattedProjects = await Promise.all(
        projects.map(async (project) => {
          const teamMembers = project.teamId
            ? await db.sequelize.query(
                `
                SELECT u.id, u.firstName, u.lastName, u.email, u.phoneNumber
                FROM Users u
                INNER JOIN UserTeams ut ON u.id = ut.userId
                WHERE ut.teamId = :teamId
                `,
                {
                  replacements: { teamId: project.teamId },
                  type: db.sequelize.QueryTypes.SELECT,
                }
              )
            : [];

          const tasks = await db.sequelize.query(
            `
            SELECT id, title, description, status, dueDate
            FROM Tasks
            WHERE projectId = :projectId
            `,
            {
              replacements: { projectId: project.id },
              type: db.sequelize.QueryTypes.SELECT,
            }
          );

          return {
            id: project.id,
            name: project.name,
            description: project.description,
            startDate: project.startDate,
            endDate: project.endDate,
            status: project.status,
            client: project.clientId
              ? {
                  id: project.clientId,
                  firstName: project.clientFirstName,
                  lastName: project.clientLastName,
                  email: project.clientEmail,
                  image: project.clientImage,
                }
              : null,
            team: project.teamId
              ? {
                  teamId: project.teamId,
                  teamName: project.teamName,
                  members: teamMembers.map((user) => ({
                    userId: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    phoneNumber: user.phoneNumber || null,
                  })),
                }
              : null,
            tasks: tasks.map((task) => ({
              id: task.id,
              title: task.title,
              description: task.description,
              status: task.status,
              dueDate: task.dueDate,
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

      return res.status(200).json({ projects: formattedProjects, pagination });
    } catch (err) {
      console.error("Get projects error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
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

      const validStatuses = ["To Do", "In Progress", "Review", "Done"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      // Check if project exists
      const project = await db.Project.findByPk(projectId, {
        attributes: ["id", "name", "description", "startDate", "endDate", "status", "createdAt", "updatedAt"],
      });
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check if user is assigned to the project
      const assigned = await db.UserTeam.findOne({
        where: { userId: req.user.id, projectId },
      });
      if (!assigned) {
        return res.status(403).json({
          message: "You're not assigned to this project",
        });
      }

      // Update project status
      await db.Project.update(
        { status, updatedAt: new Date() },
        { where: { id: projectId } }
      );

      // Fetch updated project
      const updatedProject = await db.Project.findByPk(projectId, {
        attributes: ["id", "name", "description", "startDate", "endDate", "status", "createdAt", "updatedAt"],
      });
      if (!updatedProject) {
        return res.status(500).json({ message: "Failed to update project status" });
      }

      // Fetch assigned users
      const assignedUsers = await db.sequelize.query(
        `
        SELECT u.email, u.firstName, u.phoneNumber
        FROM Users u
        INNER JOIN UserTeams ut ON u.id = ut.userId
        WHERE ut.projectId = :projectId
        `,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      // Fetch admins and managers
      const adminsAndManagers = await db.User.findAll({
        where: { role: ["admin", "manager"] },
        attributes: ["email", "firstName", "phoneNumber"],
      });

      // Collect unique emails
      const uniqueEmails = new Set([
        ...assignedUsers.map((u) => u.email),
        ...adminsAndManagers.map((u) => u.email),
      ]);

      // Send email notifications
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

      // Notify client if project is completed
      if (status.toLowerCase() === "done") {
        await notifyClientOnProjectCompletion(projectId);
      }

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

      // Check if project exists
      const project = await db.Project.findByPk(projectId, {
        attributes: ["id", "name"],
      });
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Validate teamId if provided
      if (teamId) {
        const team = await db.Team.findByPk(teamId, {
          attributes: ["id"],
        });
        if (!team) {
          return res.status(404).json({ message: "Team not found" });
        }
      }

      // Build the update object
      const updates = {};
      if (name) updates.name = name;
      if (description !== undefined) updates.description = description || null;
      if (startDate) updates.startDate = startDate;
      if (endDate !== undefined) updates.endDate = endDate || null;
      if (status) {
        const validStatuses = ["To Do", "In Progress", "Review", "Done"];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ message: "Invalid status value" });
        }
        updates.status = status;
      }
      if (teamId) updates.teamId = teamId;
      updates.updatedAt = new Date();

      // Update project
      if (Object.keys(updates).length > 1 || (Object.keys(updates).length === 1 && !updates.updatedAt)) {
        await db.Project.update(updates, { where: { id: projectId } });
      }

      // Fetch updated project
      const updatedProject = await db.Project.findByPk(projectId, {
        attributes: ["id", "name", "description", "startDate", "endDate", "status", "createdAt", "updatedAt"],
      });
      if (!updatedProject) {
        return res.status(500).json({ message: "Failed to update project" });
      }

      // Notify team members if teamId is updated
      if (teamId) {
        const teamMembers = await db.sequelize.query(
          `
          SELECT u.email, u.firstName, u.phoneNumber
          FROM Users u
          INNER JOIN UserTeams ut ON u.id = ut.userId
          WHERE ut.teamId = :teamId
          `,
          {
            replacements: { teamId },
            type: db.sequelize.QueryTypes.SELECT,
          }
        );

        const emailPromises = teamMembers.map((user) =>
          sendMail({
            to: user.email,
            subject: `Project Updated: ${name || project.name}`,
            html: `
              <p>Hello ${user.firstName},</p>
              <p>Your team has been assigned to the updated project <strong>${name || project.name}</strong>.</p>
              <p><strong>Contact Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
              <p>Check your dashboard for details.</p>
              <p>Best,<br>Team</p>
            `,
          })
        );

        await Promise.all(emailPromises);
      }

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

      const [project] = await db.sequelize.query(
        `SELECT id, name FROM Projects WHERE id = :projectId`,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const users = await db.sequelize.query(
        `
        SELECT u.email, u.firstName, u.phoneNumber
        FROM Users u
        INNER JOIN UserTeams ut ON u.id = ut.userId
        WHERE ut.projectId = :projectId
        `,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      await db.sequelize.query(
        `DELETE FROM Projects WHERE id = :projectId`,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.DELETE,
        }
      );

      const emailPromises = users.map((user) =>
        sendMail({
          to: user.email,
          subject: `Project Deleted: ${project.name}`,
          html: `
            <p>Hello ${user.firstName},</p>
            <p>The project <strong>${project.name}</strong> you were assigned to has been deleted.</p>
            <p><strong>Contact Phone:</strong> ${user.phoneNumber || "Not provided"}</p>
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

      const [project] = await db.sequelize.query(
        `SELECT id FROM Projects WHERE id = :projectId`,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );
      if (!project) {
        return res.status(404).json({ message: "Project not found." });
      }

      const [client] = await db.sequelize.query(
        `SELECT id FROM Clients WHERE id = :clientId`,
        {
          replacements: { clientId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );
      if (!client) {
        return res.status(404).json({ message: "Client not found." });
      }

      await db.sequelize.query(
        `
        INSERT INTO ClientProjects (projectId, clientId)
        VALUES (:projectId, :clientId)
        ON DUPLICATE KEY UPDATE projectId = projectId
        `,
        {
          replacements: { projectId, clientId },
          type: db.sequelize.QueryTypes.INSERT,
        }
      );

      return res
        .status(200)
        .json({ message: "Client added to project successfully." });
    } catch (err) {
      console.error("Add client to project error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
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

      const affectedRows = await db.sequelize.query(
        `
        DELETE FROM ClientProjects
        WHERE projectId = :projectId AND clientId = :clientId
        `,
        {
          replacements: { projectId, clientId },
          type: db.sequelize.QueryTypes.DELETE,
        }
      );

      if (affectedRows[1] === 0) {
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
