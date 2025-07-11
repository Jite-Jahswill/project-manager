const { Client, Project } = require("../models");
const path = require("path");
const fs = require("fs");
const sendMail = require("../utils/mailer").sendMail;
const { Op } = require("sequelize");

exports.createClient = async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    const image = req.file ? req.file.filename : null;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const exists = await Client.findOne({ where: { email } });
    if (exists) {
      return res.status(400).json({ error: "Client already exists" });
    }

    const client = await Client.create({ firstName, lastName, email, image });
    res.status(201).json({ message: "Client created", client });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error creating client", details: err.message });
  }
};

exports.getAllClients = async (req, res) => {
  try {
    const { firstName, lastName, email } = req.query;

    const searchCriteria = {};
    if (firstName) searchCriteria.firstName = { [Op.like]: `%${firstName}%` };
    if (lastName) searchCriteria.lastName = { [Op.like]: `%${lastName}%` };
    if (email) searchCriteria.email = { [Op.like]: `%${email}%` };

    const clients = await Client.findAll({ where: searchCriteria });
    res.json(clients);
  } catch (err) {
    console.error("Get clients error:", err);
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
    res.status(500).json({ error: "Failed to fetch client" });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: "Client not found" });

    const { firstName, lastName, email } = req.body;
    const image = req.file ? req.file.filename : client.image;

    if (req.file && client.image) {
      const oldPath = path.join(__dirname, "../uploads", client.image);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await client.update({ firstName, lastName, email, image });
    res.json({ message: "Client updated", client });
  } catch (err) {
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
      const filePath = path.join(__dirname, "../uploads", client.image);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await client.destroy();
    res.json({ message: "Client deleted" });
  } catch (err) {
    res.status(500).json({ error: "Error deleting client" });
  }
};

// Notify client when project is completed (call this from project controller)
exports.notifyClientOnProjectCompletion = async (projectId) => {
  const project = await Project.findByPk(projectId, { include: Client });
  if (project && project.Client) {
    await sendMail(
      project.Client.email,
      `Your project '${project.name}' is complete!`,
      `<p>Hi ${project.Client.firstName},</p>
       <p>Your project <strong>${project.name}</strong> has been marked as completed.</p>`
    );
  }
};
