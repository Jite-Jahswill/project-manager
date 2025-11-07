const { Client, Project, Team, User, Task } = require("../models");
const path = require("path");
const fs = require("fs");
const sendMail = require("../utils/mailer");
const { Op } = require("sequelize");
const sequelize = require("../config/db.config");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const admin = require("firebase-admin");

// Generate a 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

module.exports = {
  // Get current client's details
  async getCurrentClient(req, res) {
    try {
      const client = await Client.findByPk(req.user.id, {
        attributes: { exclude: ["password", "otp", "otpExpiresAt"] },
        include: [
          {
            model: Project,
            as: "Projects",
            include: [
              {
                model: Team,
                as: "Teams",
                attributes: ["id", "name"],
                include: [
                  {
                    model: User,
                    attributes: ["id", "firstName", "lastName", "email"],
                    through: { attributes: ["role", "note"] },
                  },
                ],
              },
              {
                model: Task,
                as: "Tasks",
                attributes: ["id", "title", "description", "status", "dueDate"],
                include: [
                  {
                    model: User,
                    as: "assignee",
                    attributes: ["id", "firstName", "lastName", "email"],
                  },
                ],
              },
            ],
          },
        ],
      });
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      const formattedClient = {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        image: client.image,
        phoneNumber: client.phoneNumber,
        address: client.address,
        city: client.city,
        state: client.state,
        country: client.country,
        bankName: client.bankName,
        accountNumber: client.accountNumber,
        accountName: client.accountName,
        approvalStatus: client.approvalStatus,
        projects: client.Projects.map((project) => {
          const teams = (project.Teams || []).map((team) => ({
            teamId: team.id,
            teamName: team.name,
            members: (team.Users || []).map((user) => ({
              userId: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              role: user.UserTeam?.role,
              note: user.UserTeam?.note,
            })),
          }));
       
          return {
            id: project.id,
            name: project.name,
            description: project.description,
            startDate: project.startDate,
            endDate: project.endDate,
            status: project.status,
       
            // derive one "team" (first)
            team: teams.length > 0 ? teams[0] : null,
       
            // include all "teams"
            teams,
       
            tasks: (project.Tasks || []).map((task) => ({
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
          };
        }),
      };
      res.status(200).json({ client: formattedClient });
    } catch (err) {
      console.error("Get current client error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to fetch client", details: err.message });
    }
  },
  
  // CREATE CLIENT → AUDIT: CREATE
  async createClient(req, res) {
    let transaction = null;
    try {
      transaction = await sequelize.transaction();

      const {
        firstName, lastName, email, phoneNumber, address, city, state, country,
        bankName, accountNumber, accountName,
      } = req.body;

      const files = req.uploadedFiles || [];
      const cacCertificate = files.find(f => f.originalname?.toLowerCase().includes("cac"))?.firebaseUrl || null;
      const tin = files.find(f => f.originalname?.toLowerCase().includes("tin"))?.firebaseUrl || null;
      const taxClearance = files.find(f => f.originalname?.toLowerCase().includes("tax"))?.firebaseUrl || null;
      const corporateProfile = files.find(f => f.originalname?.toLowerCase().includes("profile"))?.firebaseUrl || null;
      const image = files.find(f => ["image/jpeg", "image/png", "image/webp"].includes(f.mimetype))?.firebaseUrl || null;

      if (!firstName || !lastName || !email) {
        if (transaction) await transaction.rollback();
        return res.status(400).json({ message: "firstName, lastName, and email are required" });
      }

      const exists = await Client.findOne({ where: { email }, transaction });
      if (exists) {
        if (transaction) await transaction.rollback();
        return res.status(409).json({ message: "Client with this email already exists" });
      }

      const autoPassword = crypto.randomBytes(8).toString("hex");
      const hashedPassword = await bcrypt.hash(autoPassword, 10);
      const otp = generateOTP();
      const hashedOTP = await bcrypt.hash(otp, 10);
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      const client = await Client.create(
        {
          firstName, lastName, email, password: hashedPassword, image,
          emailVerified: false, otp: hashedOTP, otpExpiresAt, phoneNumber,
          cacCertificate, tin, taxClearance, corporateProfile,
          address, city, state, country, bankName, accountNumber, accountName,
          approvalStatus: "approved",
        },
        { transaction }
      );

      await transaction.commit();
      transaction = null;

      // SEND EMAIL (fire-and-forget)
      sendMail({
        to: client.email,
        subject: "Welcome! Verify Your Client Account",
        html: `
          <p>Hello ${client.firstName},</p>
          <p>Your client account has been created.</p>
          <p><strong>Email:</strong> ${client.email}</p>
          <p><strong>Password:</strong> ${autoPassword}</p>
          <p><strong>OTP:</strong> ${otp}</p>
          <p>Best,<br>Team</p>
        `,
      }).catch(err => console.error("Email failed:", err.message));

      // AUDIT: CREATE → responseData has client.id
      return res.status(201).json({
        message: "Client created",
        client: {
          id: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
          image: client.image,
          approvalStatus: client.approvalStatus,
        },
      });
    } catch (err) {
      if (transaction) await transaction.rollback();
      console.error("Create client error:", err);
      return res.status(500).json({ message: "Failed to create client", details: err.message });
    }
  },

  // Get projects owned by a client
  async getClientProjects(req, res) {
    try {
      const { clientId } = req.params;
      const { page = 1, limit = 20 } = req.query;
  
      if (!clientId) {
        return res.status(400).json({ message: "clientId is required" });
      }
  
      const client = await Client.findByPk(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
  
      if (client.approvalStatus !== "approved") {
        return res.status(403).json({ message: "Client registration not approved" });
      }
  
      const { count, rows } = await Project.findAndCountAll({
        include: [
          {
            model: Client,
            as: "Clients",
            where: { id: clientId },
            through: { attributes: [] },
            attributes: [],
          },
          {
            model: Team,
            as: "Teams",
            through: { attributes: [] },
            attributes: ["id", "name"],
            include: [
              {
                model: User,
                attributes: ["id", "firstName", "lastName", "email", "phoneNumber"],
                through: { attributes: ["role", "note"] },
              },
            ],
          },
          {
            model: Task,
            as: "Tasks",
            attributes: ["id", "title", "description", "status", "dueDate"],
            include: [
              {
                model: User,
                as: "assignee",
                attributes: ["id", "firstName", "lastName", "email"],
              },
            ],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
      });
  
      // ✅ Safe and correct mapping with "Teams"
      const projects = rows.map((project) => {
        const teams = (project.Teams || []).map((team) => ({
          teamId: team.id,
          teamName: team.name,
          members: (team.Users || []).map((user) => ({
            userId: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            phoneNumber: user.phoneNumber || null,
            role: user.UserTeam?.role || null,
            note: user.UserTeam?.note || null,
          })),
        }));
      
        return {
          id: project.id,
          name: project.name,
          description: project.description,
          startDate: project.startDate,
          endDate: project.endDate,
          status: project.status,
      
          // 👇 derived first team (if any)
          team: teams.length > 0 ? teams[0] : null,
      
          // 👇 full teams array
          teams,
      
          tasks: (project.Tasks || []).map((task) => ({
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
        };
      });

      const totalPages = Math.ceil(count / limit);
  
      res.status(200).json({
        projects,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (err) {
      console.error("Get client projects error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        clientId: req.params.clientId,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to fetch client projects", details: err.message });
    }
  },

  // // Create a new client
  // async createClient(req, res) {
  //   let transaction = null;
  //   try {
  //     transaction = await sequelize.transaction();
  
  //     const {
  //       firstName,
  //       lastName,
  //       email,
  //       phoneNumber,
  //       address,
  //       city,
  //       state,
  //       country,
  //       bankName,
  //       accountNumber,
  //       accountName,
  //     } = req.body;
  
  //     // Extract uploaded files (if any)
  //     const files = req.uploadedFiles || [];
  //     const cacCertificate =
  //       files.find((f) => f.originalname?.toLowerCase().includes("cac"))?.firebaseUrl || null;
  //     const tin =
  //       files.find((f) => f.originalname?.toLowerCase().includes("tin"))?.firebaseUrl || null;
  //     const taxClearance =
  //       files.find((f) => f.originalname?.toLowerCase().includes("tax"))?.firebaseUrl || null;
  //     const corporateProfile =
  //       files.find((f) => f.originalname?.toLowerCase().includes("profile"))?.firebaseUrl || null;
  //     const image =
  //       files.find((f) =>
  //         ["image/jpeg", "image/png", "image/webp"].includes(f.mimetype)
  //       )?.firebaseUrl || null;
  
  //     // Only validate required text fields
  //     if (!firstName || !lastName || !email) {
  //       // safe rollback
  //       if (transaction) {
  //         try { await transaction.rollback(); } catch (_) {}
  //       }
  //       return res.status(400).json({
  //         message: "firstName, lastName, and email are required",
  //       });
  //     }
  
  //     // Check for duplicate email (inside transaction)
  //     const exists = await Client.findOne({ where: { email }, transaction });
  //     if (exists) {
  //       try { await transaction.rollback(); } catch (_) {}
  //       return res.status(409).json({ message: "Client with this email already exists" });
  //     }
  
  //     // Generate password & OTP
  //     const autoPassword = crypto.randomBytes(8).toString("hex");
  //     const hashedPassword = await bcrypt.hash(autoPassword, 10);
  //     const otp = generateOTP();
  //     const hashedOTP = await bcrypt.hash(otp, 10);
  //     const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  
  //     // Create client – all file fields are optional (can be null)
  //     const client = await Client.create(
  //       {
  //         firstName,
  //         lastName,
  //         email,
  //         password: hashedPassword,
  //         image,
  //         emailVerified: false,
  //         otp: hashedOTP,
  //         otpExpiresAt,
  //         phoneNumber,
  //         cacCertificate,
  //         tin,
  //         taxClearance,
  //         corporateProfile,
  //         address,
  //         city,
  //         state,
  //         country,
  //         bankName,
  //         accountNumber,
  //         accountName,
  //         approvalStatus: "approved",
  //       },
  //       { transaction }
  //     );
  
  //     // Commit transaction BEFORE external IO (email)
  //     await transaction.commit();
  //     transaction = null; // mark as finished for safety
  
  //     // Send welcome email with login + OTP — do not let this break the response.
  //     // Fire-and-log: start sendMail but keep response independent.
  //     sendMail({
  //       to: client.email,
  //       subject: "Welcome! Verify Your Client Account",
  //       html: `
  //         <p>Hello ${client.firstName},</p>
  //         <p>Your client account has been created successfully. Below are your login details:</p>
  //         <p><strong>Email:</strong> ${client.email}</p>
  //         <p><strong>Password:</strong> ${autoPassword}</p>
  //         <p><strong>OTP for email verification:</strong> ${otp}</p>
  //         <p>Please use the OTP to verify your email. The OTP expires in 10 minutes.</p>
  //         <p>Your registration is pending approval. You will be notified once approved.</p>
  //         <p>For security, we recommend changing your password from your dashboard at <a href="http://<your-app-url>/dashboard/change-password">Change Password</a>.</p>
  //         <p>Best,<br>Team</p>
  //       `,
  //     }).catch((emailErr) => {
  //       // Log but don't throw
  //       console.error("Email sending error (post-commit):", emailErr && emailErr.message ? emailErr.message : emailErr);
  //     });
  
  //     // Respond success (email may still be sending)
  //     return res.status(201).json({
  //       message: "Client created successfully. OTP and password will be sent to email (if mailer succeeds).",
  //       client: {
  //         id: client.id,
  //         firstName: client.firstName,
  //         lastName: client.lastName,
  //         email: client.email,
  //         image: client.image,
  //         phoneNumber: client.phoneNumber,
  //         approvalStatus: client.approvalStatus,
  //       },
  //     });
  //   } catch (err) {
  //     // Attempt rollback only if transaction exists
  //     if (transaction) {
  //       try {
  //         await transaction.rollback();
  //       } catch (rbErr) {
  //         // ignore rollback errors (transaction may already be finished)
  //         console.error("Transaction rollback failed:", rbErr && rbErr.message ? rbErr.message : rbErr);
  //       }
  //     }
  
  //     console.error("Create client error:", {
  //       message: err.message,
  //       stack: err.stack,
  //       userId: req.user?.id,
  //       body: req.body,
  //       timestamp: new Date().toISOString(),
  //     });
  
  //     return res.status(500).json({ message: "Failed to create client", details: err.message });
  //   }
  // },

// UPDATE COMPANY INFO → AUDIT: UPDATE
  async uploadCompanyInfo(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { id } = req.params;
      const client = await Client.findByPk(id, { transaction });
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ message: "Client not found" });
      }

      // CAPTURE OLD DATA FOR AUDIT
      req.body._previousData = client.toJSON();

      const files = req.uploadedFiles || [];
      const cacCertificate =
        files.find((f) => f.originalname.toLowerCase().includes("cac"))
          ?.firebaseUrl || client.cacCertificate;
      const tin =
        files.find((f) => f.originalname.toLowerCase().includes("tin"))
          ?.firebaseUrl || client.tin;
      const taxClearance =
        files.find((f) => f.originalname.toLowerCase().includes("tax"))
          ?.firebaseUrl || client.taxClearance;
      const corporateProfile =
        files.find((f) => f.originalname.toLowerCase().includes("profile"))
          ?.firebaseUrl || client.corporateProfile;

      if (!cacCertificate || !tin || !taxClearance || !corporateProfile) {
        await transaction.rollback();
        return res.status(400).json({ message: "All documents required" });
      }

      await sequelize.query(
        `UPDATE Clients SET cacCertificate = :cacCertificate, tin = :tin, taxClearance = :taxClearance, corporateProfile = :corporateProfile, approvalStatus = 'pending' WHERE id = :id`,
        {
          replacements: {
            cacCertificate,
            tin,
            taxClearance,
            corporateProfile,
            id,
          },
          type: sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      await sendMail({
        to: client.email,
        subject: "Company Info Updated",
        html: `<p>Pending approval.</p>`,
      });

      const updatedClient = await Client.findByPk(id, {
        attributes: { exclude: ["password", "otp", "otpExpiresAt"] },
        transaction,
      });

      await transaction.commit();
      return res
        .status(200)
        .json({ message: "Company info updated", client: updatedClient });
    } catch (err) {
      await transaction.rollback();
      console.error("Upload company info error:", err);
      return res.status(500).json({ message: "Failed", details: err.message });
    }
  },

// UPDATE REGISTRATION → AUDIT: UPDATE
  async updateRegistration(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { id } = req.params;
      const {
        address,
        city,
        state,
        country,
        bankName,
        accountNumber,
        accountName,
      } = req.body;

      const client = await Client.findByPk(id, { transaction });
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ message: "Client not found" });
      }

      req.body._previousData = client.toJSON(); // AUDIT

      await sequelize.query(
        `UPDATE Clients SET address = :address, city = :city, state = :state, country = :country, bankName = :bankName, accountNumber = :accountNumber, accountName = :accountName, approvalStatus = 'pending' WHERE id = :id`,
        {
          replacements: {
            address: address || client.address,
            city: city || client.city,
            state: state || client.state,
            country: country || client.country,
            bankName: bankName || client.bankName,
            accountNumber: accountNumber || client.accountNumber,
            accountName: accountName || client.accountName,
            id,
          },
          type: sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      await sendMail({
        to: client.email,
        subject: "Registration Updated",
        html: `<p>Pending approval.</p>`,
      });

      const updatedClient = await Client.findByPk(id, {
        attributes: { exclude: ["password", "otp", "otpExpiresAt"] },
        transaction,
      });

      await transaction.commit();
      return res
        .status(200)
        .json({ message: "Registration updated", client: updatedClient });
    } catch (err) {
      await transaction.rollback();
      console.error("Update registration error:", err);
      return res.status(500).json({ message: "Failed", details: err.message });
    }
  },

  // View registration approval status
  async getApprovalStatus(req, res) {
    try {
      const { id } = req.params;
      const client = await Client.findByPk(id, {
        attributes: ["id", "firstName", "lastName", "email", "approvalStatus"],
      });
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.status(200).json({ approvalStatus: client.approvalStatus });
    } catch (err) {
      console.error("Get approval status error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        clientId: req.params.id,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to fetch approval status", details: err.message });
    }
  },

// APPROVE CLIENT → AUDIT: UPDATE
  async approveClient(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { id } = req.params;
      const { approvalStatus } = req.body;

      if (!["approved", "rejected"].includes(approvalStatus)) {
        await transaction.rollback();
        return res.status(400).json({ message: "Invalid status" });
      }

      const client = await Client.findByPk(id, { transaction });
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ message: "Client not found" });
      }

      req.body._previousData = client.toJSON(); // AUDIT

      await sequelize.query(
        `UPDATE Clients SET approvalStatus = :approvalStatus WHERE id = :id`,
        { replacements: { approvalStatus, id }, type: sequelize.QueryTypes.UPDATE, transaction }
      );

      await sendMail({
        to: client.email,
        subject: `Registration ${approvalStatus}`,
        html: `<p>Your registration has been ${approvalStatus}.</p>`,
      });

      const updatedClient = await Client.findByPk(id, { attributes: { exclude: ["password", "otp", "otpExpiresAt"] }, transaction });

      await transaction.commit();
      return res.status(200).json({ message: `Client ${approvalStatus}`, client: updatedClient });
    } catch (err) {
      await transaction.rollback();
      console.error("Approve client error:", err);
      return res.status(500).json({ message: "Failed", details: err.message });
    }
  },
  
  // CLIENT LOGIN → AUDIT: LOGIN
  async loginClient(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password)
        return res.status(400).json({ message: "Email and password required" });

      const client = await Client.findOne({ where: { email } });
      if (!client)
        return res.status(401).json({ message: "Invalid credentials" });

      const isMatch = await bcrypt.compare(password, client.password);
      if (!isMatch)
        return res.status(401).json({ message: "Invalid credentials" });

      if (!client.emailVerified)
        return res.status(403).json({ message: "Email not verified" });
      if (client.approvalStatus !== "approved")
        return res.status(403).json({ message: "Not approved" });

      const token = jwt.sign(
        { id: client.id, role: "client" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      // AUDIT: LOGIN
      req.body._auditAction = "LOGIN";
      req.body._auditModel = "Client";
      req.body._auditRecordId = client.id;

      return res.status(200).json({
        message: "Logged in",
        token,
        client: {
          id: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
          image: client.image,
          approvalStatus: client.approvalStatus,
        },
      });
    } catch (err) {
      console.error("Client login error:", err);
      return res.status(500).json({ message: "Failed", details: err.message });
    }
  },

  // Verify client email
  async verifyClient(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        await transaction.rollback();
        return res.status(400).json({ message: "email and otp are required" });
      }

      const client = await Client.findOne({ where: { email }, transaction });
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ message: "Client not found" });
      }

      req.body._previousData = client.toJSON();

      if (client.emailVerified) {
        await transaction.rollback();
        return res.status(400).json({ message: "Email already verified" });
      }

      if (!client.otp || !client.otpExpiresAt) {
        await transaction.rollback();
        return res.status(400).json({ message: "No OTP found for this client" });
      }

      if (new Date() > client.otpExpiresAt) {
        await transaction.rollback();
        return res.status(400).json({ message: "OTP expired" });
      }

      const isMatch = await bcrypt.compare(otp, client.otp);
      if (!isMatch) {
        await transaction.rollback();
        return res.status(400).json({ message: "Invalid OTP" });
      }

      await sequelize.query(
        `UPDATE Clients 
         SET emailVerified = :emailVerified, otp = :otp, otpExpiresAt = :otpExpiresAt, updatedAt = NOW()
         WHERE id = :id`,
        {
          replacements: {
            emailVerified: true,
            otp: null,
            otpExpiresAt: null,
            id: client.id,
          },
          type: sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      await sendMail({
        to: client.email,
        subject: "Email Verification Successful",
        html: `
          <p>Hello ${client.firstName},</p>
          <p>Your email has been successfully verified. You can now log in to your account.</p>
          <p>For security, we recommend reviewing your account settings at <a href="http://<your-app-url>/dashboard">Dashboard</a>.</p>
          <p>Best,<br>Team</p>
        `,
      });

      await transaction.commit();
      res.status(200).json({ message: "Email verified successfully" });
    } catch (err) {
      await transaction.rollback();
      console.error("Verify client error:", {
        message: err.message,
        stack: err.stack,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to verify email", details: err.message });
    }
  },

  // Forgot password
  async forgotPassword(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { email } = req.body;

      if (!email) {
        await transaction.rollback();
        return res.status(400).json({ message: "email is required" });
      }

      const client = await Client.findOne({ where: { email }, transaction });
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ message: "Client not found" });
      }

      const otp = generateOTP();
      const hashedOTP = await bcrypt.hash(otp, 10);
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await sequelize.query(
        `UPDATE Clients 
         SET otp = :otp, otpExpiresAt = :otpExpiresAt, updatedAt = NOW()
         WHERE id = :id`,
        {
          replacements: {
            otp: hashedOTP,
            otpExpiresAt,
            id: client.id,
          },
          type: sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      await sendMail({
        to: client.email,
        subject: "Password Reset Request",
        html: `
          <p>Hello ${client.firstName},</p>
          <p>We received a request to reset your password. Use the OTP below to proceed:</p>
          <p><strong>OTP:</strong> ${otp}</p>
          <p>This OTP expires in 10 minutes.</p>
          <p>If you did not request a password reset, please ignore this email or contact support.</p>
          <p>Best,<br>Team</p>
        `,
      });

      await transaction.commit();
      res.status(200).json({ message: "Password reset OTP sent to email" });
    } catch (err) {
      await transaction.rollback();
      console.error("Forgot password error:", {
        message: err.message,
        stack: err.stack,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to process password reset", details: err.message });
    }
  },

  // Reset password
  async resetPassword(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { email, otp, newPassword } = req.body;

      if (!email || !otp || !newPassword) {
        await transaction.rollback();
        return res.status(400).json({ message: "email, otp, and newPassword are required" });
      }

      const client = await Client.findOne({ where: { email }, transaction });
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ message: "Client not found" });
      }

      if (!client.otp || !client.otpExpiresAt) {
        await transaction.rollback();
        return res.status(400).json({ message: "No OTP found for this client" });
      }

      if (new Date() > client.otpExpiresAt) {
        await transaction.rollback();
        return res.status(400).json({ message: "OTP expired" });
      }

      const isMatch = await bcrypt.compare(otp, client.otp);
      if (!isMatch) {
        await transaction.rollback();
        return res.status(400).json({ message: "Invalid OTP" });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await sequelize.query(
        `UPDATE Clients 
         SET password = :password, otp = :otp, otpExpiresAt = :otpExpiresAt, updatedAt = NOW()
         WHERE id = :id`,
        {
          replacements: {
            password: hashedPassword,
            otp: null,
            otpExpiresAt: null,
            id: client.id,
          },
          type: sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      await sendMail({
        to: client.email,
        subject: "Password Reset Successful",
        html: `
          <p>Hello ${client.firstName},</p>
          <p>Your password has been successfully reset.</p>
          <p>For security, you can review your account settings at <a href="http://<your-app-url>/dashboard">Dashboard</a>.</p>
          <p>Best,<br>Team</p>
        `,
      });

      const previous = await Model.findByPk(id);
      req.body._previousData = previous.toJSON();

      await transaction.commit();
      res.status(200).json({ message: "Password reset successfully" });
    } catch (err) {
      await transaction.rollback();
      console.error("Reset password error:", {
        message: err.message,
        stack: err.stack,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to reset password", details: err.message });
    }
  },

  // Resend verification OTP
  async resendVerificationOTP(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { email } = req.body;

      if (!email) {
        await transaction.rollback();
        return res.status(400).json({ message: "email is required" });
      }

      const client = await Client.findOne({ where: { email }, transaction });
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ message: "Client not found" });
      }

      if (client.emailVerified) {
        await transaction.rollback();
        return res.status(400).json({ message: "Email already verified" });
      }

      const otp = generateOTP();
      const hashedOTP = await bcrypt.hash(otp, 10);
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await sequelize.query(
        `UPDATE Clients 
         SET otp = :otp, otpExpiresAt = :otpExpiresAt, updatedAt = NOW()
         WHERE id = :id`,
        {
          replacements: {
            otp: hashedOTP,
            otpExpiresAt,
            id: client.id,
          },
          type: sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      await sendMail({
        to: client.email,
        subject: "Resend Verification OTP",
        html: `
          <p>Hello ${client.firstName},</p>
          <p>We have generated a new OTP for your email verification:</p>
          <p><strong>OTP:</strong> ${otp}</p>
          <p>This OTP expires in 10 minutes.</p>
          <p>Please use this OTP to verify your email at <a href="http://<your-app-url>/verify">Verify Email</a>.</p>
          <p>If you did not request this, please ignore this email or contact support.</p>
          <p>Best,<br>Team</p>
        `,
      });

      await transaction.commit();
      res.status(200).json({ message: "Verification OTP resent to email" });
    } catch (err) {
      await transaction.rollback();
      console.error("Resend verification OTP error:", {
        message: err.message,
        stack: err.stack,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to resend verification OTP", details: err.message });
    }
  },

  // Get all clients
  async getAllClients(req, res) {
    try {
      const { firstName, lastName, email, page = 1, limit = 20 } = req.query;

      const searchCriteria = {};
      if (firstName) searchCriteria.firstName = { [Op.like]: `%${firstName}%` };
      if (lastName) searchCriteria.lastName = { [Op.like]: `%${lastName}%` };
      if (email) searchCriteria.email = { [Op.like]: `%${email}%` };

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const { count, rows } = await Client.findAndCountAll({
        where: searchCriteria,
        attributes: { exclude: ["password", "otp", "otpExpiresAt"] },
        limit: parseInt(limit),
        offset,
      });

      const totalPages = Math.ceil(count / limit);

      res.json({
        clients: rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (err) {
      console.error("Get all clients error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to fetch clients", details: err.message });
    }
  },

  // Get client by ID
  async getClientById(req, res) {
    try {
      const { id } = req.params;

      const client = await Client.findByPk(id, {
        attributes: { exclude: ["password", "otp", "otpExpiresAt"] },
      });
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json({ client });
    } catch (err) {
      console.error("Get client error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        clientId: req.params.id,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to fetch client", details: err.message });
    }
  },

  // Update client
  async updateClient(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { id } = req.params;
      if (!req.body) req.body = {};

      const client = await Client.findByPk(id, { transaction });
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ message: "Client not found" });
      }
      req.body._previousData = client.toJSON(); // AUDIT

      const { firstName, lastName, email, phoneNumber } = req.body;
      const image = req.uploadedFiles && req.uploadedFiles[0]?.firebaseUrl ? req.uploadedFiles[0].firebaseUrl : client.image;

      if (email && email !== client.email) {
        const existingClient = await Client.findOne({ where: { email }, transaction });
        if (existingClient) {
          await transaction.rollback();
          return res.status(409).json({ message: "Email already in use" });
        }
      }

      await sequelize.query(
        `UPDATE Clients 
         SET firstName = :firstName, lastName = :lastName, email = :email, image = :image, phoneNumber = :phoneNumber, updatedAt = NOW()
         WHERE id = :id`,
        {
          replacements: {
            firstName: firstName || client.firstName,
            lastName: lastName || client.lastName,
            email: email || client.email,
            image: image || null,
            phoneNumber: phoneNumber || client.phoneNumber,
            id,
          },
          type: sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      const updatedClient = await Client.findByPk(id, {
        attributes: { exclude: ["password", "otp", "otpExpiresAt"] },
        transaction,
      });

      const previous = await Model.findByPk(id);
      req.body._previousData = previous.toJSON();
      
      await transaction.commit();
      res.json({ message: "Client updated", client: updatedClient });
    } catch (err) {
      await transaction.rollback();
      console.error("Update client error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        clientId: req.params.id,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to update client", details: err.message });
    }
  },

  // Delete client
  async deleteClient(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { id } = req.params;
      if (!req.body) req.body = {};
      const client = await Client.findByPk(id, { transaction });
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ message: "Client not found" });
      }
      req.body._deletedData = client.toJSON();

      if (client.image) {
        const filePath = `Uploads/profiles/${path.basename(client.image)}`;
        try {
          await admin.storage().bucket().file(filePath).delete();
        } catch (err) {
          console.warn("Failed to delete client image from Firebase:", err.message);
        }
      }

      await Client.destroy({ where: { id }, transaction });

      req.body._deletedData = report.toJSON();

      await transaction.commit();
      res.json({ message: "Client deleted" });
    } catch (err) {
      await transaction.rollback();
      console.error("Delete client error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        clientId: req.params.id,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to delete client", details: err.message });
    }
  },

  // Notify client on project completion
  async notifyClientOnProjectCompletion(projectId) {
    try {
      const project = await Project.findByPk(projectId, {
        include: [{ model: Client, as: "Clients" }],
      });
      if (project && project.Clients && project.Clients.length > 0) {
        const emails = project.Clients.map((client) => ({
          to: client.email,
          subject: `Your project '${project.name}' is complete!`,
          html: `
            <p>Hi ${client.firstName},</p>
            <p>Your project <strong>${project.name}</strong> has been marked as completed.</p>
            <p>Best,<br>Team</p>
          `,
        }));

        await Promise.all(emails.map((email) => sendMail(email)));
      }
    } catch (err) {
      console.error("Notify client error:", {
        message: err.message,
        stack: err.stack,
        projectId,
        timestamp: new Date().toISOString(),
      });
    }
  },
  
  // Matrix stats for client dashboard
  async getClientMatrix(req, res) {
    try {
      const { clientId } = req.params;
  
      if (!clientId) {
        return res.status(400).json({ message: "clientId is required" });
      }
  
      const client = await Client.findByPk(clientId);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
  
      if (client.approvalStatus !== "approved") {
        return res.status(403).json({ message: "Client registration not approved" });
      }
  
      // 1. Total projects owned by client
      const totalProjects = await Project.count({
        include: [
          {
            model: Client,
            as: "Clients",
            where: { id: clientId },
            through: { attributes: [] },
          },
        ],
      });
  
      // 2. Completed projects
      const completedProjects = await Project.count({
        where: { status: "Done" }, // adjust if your enum is different
        include: [
          {
            model: Client,
            as: "Clients",
            where: { id: clientId },
            through: { attributes: [] },
          },
        ],
      });
  
      // 3. In-progress (not Done)
      const inProgressProjects = await Project.count({
        where: { status: { [Op.not]: "Done" } },
        include: [
          {
            model: Client,
            as: "Clients",
            where: { id: clientId },
            through: { attributes: [] },
          },
        ],
      });
  
      // 4. Pending client registrations (optional global stat)
      const approvalPendingClients = await Client.count({
        where: { approvalStatus: "pending" },
      });
  
      res.status(200).json({
        totalProjects,
        completedProjects,
        pendingProjects: inProgressProjects, // alias for clarity
        inProgressProjects,
        approvalPendingClients,
      });
    } catch (err) {
        console.error("Get client matrix error:", {
          message: err.message,
          stack: err.stack,
          userId: req.user?.id,
          clientId: req.params.clientId,
          timestamp: new Date().toISOString(),
        });
        res.status(500).json({ message: "Failed to fetch client matrix", details: err.message });
      }
    },
};
