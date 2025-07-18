const db = require("../models");
const { sendMail } = require("../utils/mailer");
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
      const [project] = await db.sequelize.query(
        `
        INSERT INTO "Projects" (name, description, "startDate", "endDate", status, "createdAt", "updatedAt")
        VALUES (:name, :description, :startDate, :endDate, 'To Do', NOW(), NOW())
        RETURNING id, name, description, "startDate", "endDate", status, "createdAt", "updatedAt";
        `,
        {
          replacements: {
            name,
            description: description || null,
            startDate: startDate || null,
            endDate: endDate || null,
          },
          type: db.sequelize.QueryTypes.INSERT,
        }
      );
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
          `SELECT id, name FROM "Teams" WHERE id = :teamId`,
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
          `SELECT id, name, "startDate", "endDate" FROM "Projects" WHERE id = :projectId`,
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
          SELECT u.id, u.email, u."firstName", u."lastName"
          FROM "Users" u
          INNER JOIN "UserTeams" ut ON u.id = ut."userId"
          WHERE ut."teamId" = :teamId
          `,
          {
            replacements: { teamId },
            type: db.sequelize.QueryTypes.SELECT,
            transaction,
          }
        );

        // Update project with teamId
        await db.sequelize.query(
          `UPDATE "Projects" SET "teamId" = :teamId, "updatedAt" = NOW() WHERE id = :projectId`,
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

  // Get all members of a project with roles (All authenticated users)
  async getProjectMembers(req, res) {
    try {
      const { projectId } = req.params;
      if (!projectId)
        return res.status(400).json({ message: "projectId is required" });

      const [project] = await db.sequelize.query(
        `SELECT id FROM "Projects" WHERE id = :projectId`,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );
      if (!project)
        return res.status(404).json({ message: "Project not found" });

      const members = await db.sequelize.query(
        `
        SELECT u.id AS userId, u."firstName", u."lastName", u.email, ut.role
        FROM "Users" u
        INNER JOIN "UserTeams" ut ON u.id = ut."userId"
        WHERE ut."projectId" = :projectId
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
      const { projectName, status, startDate } = req.query;

      let query = `
        SELECT p.id, p.name, p.description, p."startDate", p."endDate", p.status, p."teamId",
               c.id AS clientId, c."firstName" AS clientFirstName, c."lastName" AS clientLastName, c.email AS clientEmail, c.image AS clientImage,
               t.id AS teamId, t.name AS teamName
        FROM "Projects" p
        LEFT JOIN "ClientProjects" cp ON p.id = cp."projectId"
        LEFT JOIN "Clients" c ON cp."clientId" = c.id
        LEFT JOIN "Teams" t ON p."teamId" = t.id
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
        whereClauses.push(`DATE(p."startDate") = :startDate`);
        replacements.startDate = startDate;
      }

      if (whereClauses.length > 0) {
        query += ` WHERE ${whereClauses.join(" AND ")}`;
      }

      const projects = await db.sequelize.query(query, {
        replacements,
        type: db.sequelize.QueryTypes.SELECT,
      });

      // Fetch team members and tasks for each project
      const formattedProjects = await Promise.all(
        projects.map(async (project) => {
          const teamMembers = project.teamId
            ? await db.sequelize.query(
                `
                SELECT u.id, u."firstName", u."lastName", u.email
                FROM "Users" u
                INNER JOIN "UserTeams" ut ON u.id = ut."userId"
                WHERE ut."teamId" = :teamId
                `,
                {
                  replacements: { teamId: project.teamId },
                  type: db.sequelize.QueryTypes.SELECT,
                }
              )
            : [];

          const tasks = await db.sequelize.query(
            `
            SELECT id, title, description, status, "dueDate"
            FROM "Tasks"
            WHERE "projectId" = :projectId
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

      return res.status(200).json({ projects: formattedProjects });
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
      const [project] = await db.sequelize.query(
        `SELECT id, name FROM "Projects" WHERE id = :projectId`,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Check if user is assigned to the project
      const [assigned] = await db.sequelize.query(
        `
        SELECT * FROM "UserTeams"
        WHERE "userId" = :userId AND "projectId" = :projectId
        `,
        {
          replacements: { userId: req.user.id, projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!assigned) {
        return res.status(403).json({
          message: "You're not assigned to this project",
        });
      }

      // Update project status
      const [updatedProject] = await db.sequelize.query(
        `
        UPDATE "Projects"
        SET status = :status, "updatedAt" = NOW()
        WHERE id = :projectId
        RETURNING id, name, description, "startDate", "endDate", status, "createdAt", "updatedAt";
        `,
        {
          replacements: { status, projectId },
          type: db.sequelize.QueryTypes.UPDATE,
        }
      );

      if (!updatedProject) {
        return res.status(500).json({ message: "Failed to update project status" });
      }

      // Fetch assigned users
      const assignedUsers = await db.sequelize.query(
        `
        SELECT u.email, u."firstName"
        FROM "Users" u
        INNER JOIN "UserTeams" ut ON u.id = ut."userId"
        WHERE ut."projectId" = :projectId
        `,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      // Fetch admins and managers
      const adminsAndManagers = await db.sequelize.query(
        `
        SELECT email, "firstName" FROM "Users"
        WHERE role IN ('admin', 'manager')
        `,
        {
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

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
      const [project] = await db.sequelize.query(
        `SELECT id, name FROM "Projects" WHERE id = :projectId`,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      // Build the UPDATE query dynamically
      const updates = [];
      const replacements = { projectId };

      if (name) {
        updates.push(`name = :name`);
        replacements.name = name;
      }
      if (description !== undefined) {
        updates.push(`description = :description`);
        replacements.description = description || null;
      }
      if (startDate) {
        updates.push(`"startDate" = :startDate`);
        replacements.startDate = startDate;
      }
      if (endDate !== undefined) {
        updates.push(`"endDate" = :endDate`);
        replacements.endDate = endDate || null;
      }
      if (status) {
        const validStatuses = ["To Do", "In Progress", "Review", "Done"];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ message: "Invalid status value" });
        }
        updates.push(`status = :status`);
        replacements.status = status;
      }
      if (teamId) {
        const [team] = await db.sequelize.query(
          `SELECT id FROM "Teams" WHERE id = :teamId`,
          {
            replacements: { teamId },
            type: db.sequelize.QueryTypes.SELECT,
          }
        );
        if (!team) {
          return res.status(404).json({ message: "Team not found" });
        }
        updates.push(`"teamId" = :teamId`);
        replacements.teamId = teamId;
      }

      let updatedProject;
      if (updates.length > 0) {
        const query = `
          UPDATE "Projects"
          SET ${updates.join(", ")}, "updatedAt" = NOW()
          WHERE id = :projectId
          RETURNING id, name, description, "startDate", "endDate", status, "createdAt", "updatedAt";
        `;
        [updatedProject] = await db.sequelize.query(query, {
          replacements,
          type: db.sequelize.QueryTypes.UPDATE,
        });
      } else {
        [updatedProject] = await db.sequelize.query(
          `SELECT id, name, description, "startDate", "endDate", status, "createdAt", "updatedAt" FROM "Projects" WHERE id = :projectId`,
          {
            replacements: { projectId },
            type: db.sequelize.QueryTypes.SELECT,
          }
        );
      }

      if (!updatedProject) {
        return res.status(500).json({ message: "Failed to update project" });
      }

      // Notify team members if teamId is updated
      if (teamId) {
        const teamMembers = await db.sequelize.query(
          `
          SELECT u.email, u."firstName"
          FROM "Users" u
          INNER JOIN "UserTeams" ut ON u.id = ut."userId"
          WHERE ut."teamId" = :teamId
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
        `SELECT id, name FROM "Projects" WHERE id = :projectId`,
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
        SELECT u.email, u."firstName"
        FROM "Users" u
        INNER JOIN "UserTeams" ut ON u.id = ut."userId"
        WHERE ut."projectId" = :projectId
        `,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );

      await db.sequelize.query(
        `DELETE FROM "Projects" WHERE id = :projectId`,
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
        `SELECT id FROM "Projects" WHERE id = :projectId`,
        {
          replacements: { projectId },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );
      if (!project) {
        return res.status(404).json({ message: "Project not found." });
      }

      const [client] = await db.sequelize.query(
        `SELECT id FROM "Clients" WHERE id = :clientId`,
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
        INSERT INTO "ClientProjects" ("projectId", "clientId")
        VALUES (:projectId, :clientId)
        ON CONFLICT DO NOTHING
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
        DELETE FROM "ClientProjects"
        WHERE "projectId" = :projectId AND "clientId" = :clientId
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
