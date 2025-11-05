// routes/audit.routes.js
const express = require("express");
const auditController = require("../controllers/audit.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * /api/audits:
   *   get:
   *     summary: Get audit logs
   *     tags: [Audit]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: query
   *         name: model
   *         schema: { type: string }
   *       - in: query
   *         name: action
   *         schema: { type: string, enum: [CREATE, UPDATE, DELETE, LOGIN, LOGOUT] }
   *       - in: query
   *         name: userId
   *         schema: { type: integer }
   *       - in: query
   *         name: startDate
   *         schema: { type: string, format: date }
   *       - in: query
   *         name: endDate
   *         schema: { type: string, format: date }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 50 }
   *     responses:
   *       200:
   *         description: Audit logs
   */
  router.get("/", verifyToken, hasPermission("audit:read"), auditController.getAudits);

  /**
   * @swagger
   * /api/audits/export:
   *   get:
   *     summary: Export audit logs as CSV
   *     tags: [Audit]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: query
   *         name: model
   *         schema: { type: string }
   *       - in: query
   *         name: action
   *         schema: { type: string }
   *       - in: query
   *         name: startDate
   *         schema: { type: string, format: date }
   *       - in: query
   *         name: endDate
   *         schema: { type: string, format: date }
   *     responses:
   *       200:
   *         description: CSV file
   *         content:
   *           text/csv:
   *             schema:
   *               type: string
   *               format: binary
   */
  router.get("/export", verifyToken, hasPermission("audit:read"), auditController.exportAuditsCSV);

  app.use("/api/audits", router);
};
