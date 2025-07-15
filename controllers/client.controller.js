const { Client, Project } = require("../models");
const path = require("path");
const fs = require("fs");
const sendMail = require("../utils/mailer").sendMail;
const { Op } = require("sequelize");
const sequelize = require("../config/db"); // Use instantiated sequelize
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// Generate a 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

exports.createClient = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { firstName, lastName, email } = req.body;
    const image = req.file ? `uploads/profiles/${req.file.filename}` : null;

    if (!firstName || !lastName || !email) {
      await transaction.rollback();
      return res.status(400).json({ message: "firstName, lastName, and email are required" });
    }

    const exists = await Client.findOne({ where: { email }, transaction });
    if (exists) {
      await transaction.rollback();
      return res.status(409).json({ message: "Client with this email already exists" });
    }

    const autoPassword = crypto.randomBytes(8).toString("hex");
    const hashedPassword = await bcrypt.hash(autoPassword, 10);
    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const client = await Client.create(
      {
        firstName,
        lastName,
        email,
        password: hashedPassword,
        image,
        emailVerified: false,
        otp: hashedOTP,
        otpExpiresAt,
      },
      { transaction }
    );

    await sendMail({
      to: client.email,
      subject: "Welcome! Verify Your Client Account",
      html: `
        <p>Hello ${client.firstName},</p>
        <p>Your client account has been created successfully. Below are your login details:</p>
        <p><strong>Email:</strong> ${client.email}</p>
        <p><strong>Password:</strong> ${autoPassword}</p>
        <p><strong>OTP for email verification:</strong> ${otp}</p>
        <p>Please use the OTP to verify your email. The OTP expires in 10 minutes.</p>
        <p>For security, we recommend changing your password from your dashboard at <a href="http://<your-app-url>/dashboard/change-password">Change Password</a>.</p>
        <p>Best,<br>Team</p>
      `,
    });

    await transaction.commit();
    res.status(201).json({
      message: "Client created successfully, OTP and password sent to email",
      client: {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        image: client.image,
      },
    });
  } catch (err) {
    await transaction.rollback();
    console.error("Create client error:", {
      message: err.message,
      stack: err.stack,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ message: "Failed to create client", details: err.message });
  }
};

exports.loginClient = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const client = await Client.findOne({ where: { email } });
    if (!client) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, client.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!client.emailVerified) {
      return res.status(403).json({ message: "Email not verified" });
    }

    const token = jwt.sign(
      { id: client.id, role: "client" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({
      message: "Client logged in successfully",
      token,
      client: {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        image: client.image,
      },
    });
  } catch (err) {
    console.error("Client login error:", {
      message: err.message,
      stack: err.stack,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ message: "Failed to login client", details: err.message });
  }
};

exports.verifyClient = async (req, res) => {
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

    await client.update(
      { emailVerified: true, otp: null, otpExpiresAt: null },
      { transaction }
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
};

exports.forgotPassword = async (req, res) => {
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

    await client.update({ otp: hashedOTP, otpExpiresAt }, { transaction });

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
};

exports.resetPassword = async (req, res) => {
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
    await client.update(
      { password: hashedPassword, otp: null, otpExpiresAt: null },
      { transaction }
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
};

exports.getAllClients = async (req, res) => {
  try {
    const { firstName, lastName, email, page = 1, limit = 20 } = req.query;

    const searchCriteria = {};
    if (firstName) searchCriteria.firstName = { [Op.like]: `%${firstName}%` };
    if (lastName) searchCriteria.lastName = { [Op.like]: `%${lastName}%` };
    if (email) searchCriteria.email = { [Op.like]: `%${email}%` };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { count, rows } = await Client.findAndCountAll({
      where: searchCriteria,
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
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to fetch clients", details: err.message });
  }
};

exports.getClientById = async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: "Client not found" });
    res.json(client);
  } catch (err) {
    console.error("Get client error:", {
      message: err.message,
      stack: err.stack,
      clientId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to fetch client", details: err.message });
  }
};

exports.updateClient = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const client = await Client.findByPk(id, { transaction });
    if (!client) {
      await transaction.rollback();
      return res.status(404).json({ error: "Client not found" });
    }

    const { firstName, lastName, email } = req.body;
    const image = req.file ? `uploads/profiles/${req.file.filename}` : client.image;

    // Delete old image if new one is uploaded
    if (req.file && client.image) {
      const oldPath = path.join(__dirname, "../uploads", client.image);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // Check if email is changing and already exists
    if (email && email !== client.email) {
      const existingClient = await Client.findOne({ where: { email }, transaction });
      if (existingClient) {
        await transaction.rollback();
        return res.status(409).json({ error: "Email already in use" });
      }
    }

    // Update using Sequelize model method
    await client.update(
      {
        firstName: firstName || client.firstName,
        lastName: lastName || client.lastName,
        email: email || client.email,
        image,
      },
      { transaction }
    );

    await transaction.commit();
    res.json({ message: "Client updated", client });
  } catch (err) {
    await transaction.rollback();
    console.error("Update client error:", {
      message: err.message,
      stack: err.stack,
      clientId: req.params.id,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Error updating client", details: err.message });
  }
};

exports.deleteClient = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const client = await Client.findByPk(req.params.id, { transaction });
    if (!client) {
      await transaction.rollback();
      return res.status(404).json({ error: "Client not found" });
    }

    if (client.image) {
      const filePath = path.join(__dirname, "../Uploads", client.image);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await client.destroy({ transaction });
    await transaction.commit();
    res.json({ message: "Client deleted" });
  } catch (err) {
    await transaction.rollback();
    console.error("Delete client error:", {
      message: err.message,
      stack: err.stack,
      clientId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Error deleting client", details: err.message });
  }
};

exports.notifyClientOnProjectCompletion = async (projectId) => {
  try {
    const project = await Project.findByPk(projectId, { include: Client });
    if (project && project.Client) {
      await sendMail({
        to: project.Client.email,
        subject: `Your project '${project.name}' is complete!`,
        html: `
          <p>Hi ${project.Client.firstName},</p>
          <p>Your project <strong>${project.name}</strong> has been marked as completed.</p>
        `,
      });
    }
  } catch (err) {
    console.error("Notify client error:", {
      message: err.message,
      stack: err.stack,
      projectId,
      timestamp: new Date().toISOString(),
    });
  }
};
