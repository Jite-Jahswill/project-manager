// controllers/audit.controller.js
const { Audit, User, sequelize } = require("../models");
const { Op } = require("sequelize");
const json2csv = require("json2csv").parse;

module.exports = {
  async getAudits(req, res) {
    try {
      const { page = 1, limit = 50, model, action, userId, startDate, endDate } = req.query;
      const where = {};

      if (model) where.model = model;
      if (action) where.action = action;
      if (userId) where.userId = userId;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt[Op.gte] = new Date(startDate);
        if (endDate) where.createdAt[Op.lte] = new Date(endDate);
      }

      const { count, rows } = await Audit.findAndCountAll({
        where,
        include: [{ model: User, as: "user", attributes: ["id", "firstName", "lastName", "email"] }],
        order: [["createdAt", "DESC"]],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
      });

      res.json({
        audits: rows,
        pagination: {
          totalItems: count,
          totalPages: Math.ceil(count / limit),
          currentPage: parseInt(page),
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch audits" });
    }
  },

  async exportAuditsCSV(req, res) {
    try {
      const { model, action, userId, startDate, endDate } = req.query;
      const where = {};

      if (model) where.model = model;
      if (action) where.action = action;
      if (userId) where.userId = userId;
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt[Op.gte] = new Date(startDate);
        if (endDate) where.createdAt[Op.lte] = new Date(endDate);
      }

      const audits = await Audit.findAll({
        where,
        include: [{ model: User, as: "user", attributes: ["email"] }],
        order: [["createdAt", "DESC"]],
        raw: true,
      });

      const fields = [
        "id",
        "action",
        "model",
        "recordId",
        "user.email",
        "ipAddress",
        "createdAt",
      ];

      const csv = json2csv(audits, { fields });

      res.header("Content-Type", "text/csv");
      res.attachment(`audit-log-${new Date().toISOString().split("T")[0]}.csv`);
      res.send(csv);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Export failed" });
    }
  },
};
