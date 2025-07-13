const { Client, Project } = require("../models");
const path = require("path");
const fs = require("fs");
const sendMail = require("../utils/mailer").sendMail;
const { Op, sequelize } = require("sequelize");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

exports.createClient = async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    const image = req.file ? `uploads/profiles/${req.file.filename}` : null;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ message: "firstName, lastName, and email are required" });
    }

    const exists = await Client.findOne({ where: { email } });
    if (exists) {
      return res.status(409).json({ message: "Client with this email already exists" });
    }

    // Auto-generate a secure password
    const autoPassword = crypto.randomBytes(8).toString("hex");
    const hashedPassword = await bcrypt.hash(autoPassword, 10);
    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const client = await Client.create({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      image,
      emailVerified: false,
      otp: hashedOTP,
      otpExpiresAt,
    });

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
    console.error("Create client error:", {
      message: err.message,
      stack: err.stack,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Failed to create client", details: err.message });
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
    res
      .status(500)
      .json({ message: "Failed to login client", details: err.message });
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
    res
      .status(500)
      .json({ error: "Failed to fetch clients", details: err.message });
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
    res
      .status(500)
      .json({ error: "Failed to fetch client", details: err.message });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Client.findByPk(id);
    if (!client) return res.status(404).json({ error: "Client not found" });

    const { firstName, lastName, email } = req.body;
    const image = req.file ? req.file.filename : client.image;

    if (req.file && client.image) {
      const oldPath = path.join(__dirname, "../Uploads", client.image);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    if (email && email !== client.email) {
      const existingClient = await Client.findOne({ where: { email } });
      if (existingClient) {
        return res.status(409).json({ error: "Email already in use" });
      }
    }

    await sequelize.query(
      "UPDATE Clients SET firstName = :firstName, lastName = :lastName, email = :email, image = :image WHERE id = :id",
      {
        replacements: {
          firstName: firstName || client.firstName,
          lastName: lastName || client.lastName,
          email: email || client.email,
          image,
          id,
        },
        type: sequelize.QueryTypes.UPDATE,
      }
    );

    // Fetch updated client to return
    const updatedClient = await Client.findByPk(id);

    res.json({ message: "Client updated", client: updatedClient });
  } catch (err) {
    console.error("Update client error:", {
      message: err.message,
      stack: err.stack,
      clientId: req.params.id,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Error updating client", details: err.message });
  }
};

exports.deleteClient = async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: "Client not found" });

    if (client.image) {
      const filePath = path.join(__dirname, "../Uploads", client.image);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await client.destroy();
    res.json({ message: "Client deleted" });
  } catch (err) {
    console.error("Delete client error:", {
      message: err.message,
      stack: err.stack,
      clientId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Error deleting client", details: err.message });
  }
};

// Notify client when project is completed (call this from project controller)
exports.notifyClientOnProjectCompletion = async (projectId) => {
  try {
    const project = await Project.findByPk(projectId, { include: Client });
    if (project && project.Client) {
      await sendMail(
        project.Client.email,
        `Your project '${project.name}' is complete!`,
        `<p>Hi ${project.Client.firstName},</p>
         <p>Your project <strong>${project.name}</strong> has been marked as completed.</p>`
      );
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
