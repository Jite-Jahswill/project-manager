// routes/risk.routes.js
const express = require("express");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const riskController = require("../controllers/risk.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Risk Register
   *     description: Manage workplace hazards, severity, likelihood, mitigation plans and ownership
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *
   *   schemas:
   *     Risk:
   *       type: object
   *       properties:
   *         id: { type: integer }
   *         hazard: { type: string, example: "Slip and Fall Hazards" }
   *         severity: { type: string, enum: [Low, Medium, High, Critical] }
   *         likelihood: { type: string, enum: [Rare, Unlikely, Possible, Likely, Almost Certain] }
   *         mitigation: { type: string, nullable: true }
   *         status: { type: string, enum: [Identified, In Progress, Mitigated, Closed], default: Identified }
   *         ownerId: { type: integer }
   *         reviewDate: { type: string, format: date, example: "2025-12-31" }
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   *         owner:
   *           type: object
   *           properties:
   *             id: { type: integer }
   *             firstName: { type: string }
   *             lastName: { type: string }
   *             email: { type: string }
   *
   *     Pagination:
   *       type: object
   *       properties:
   *         total: { type: integer }
   *         page: { type: integer }
   *         totalPages: { type: integer }
   *         itemsPerPage: { type: integer }
   *
   * /api/risk:
   *   post:
   *     summary: Create a new risk entry
   *     tags: [Risk Register]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [hazard, severity, likelihood, reviewDate]
   *             properties:
   *               hazard: { type: string }
   *               severity: { type: string, enum: [Low, Medium, High, Critical] }
   *               likelihood: { type: string, enum: [Rare, Unlikely, Possible, Likely, Almost Certain] }
   *               mitigation: { type: string }
   *               status: { type: string, enum: [Identified, In Progress, Mitigated, Closed] }
   *               ownerId: { type: integer }
   *               reviewDate: { type: string, format: date }
   *     responses:
   *       201:
   *         description: Risk created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Risk'
   *
   *   get:
   *     summary: Get all risks with search & pagination
   *     tags: [Risk Register]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *         description: Search in hazard or owner name
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200:
   *         description: Paginated list of risks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 risks:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Risk'
   *                 pagination:
   *                   $ref: '#/components/schemas/Pagination'
   *
   * /api/risk/{id}:
   *   put:
   *     summary: Update risk (raw MySQL – full control)
   *     tags: [Risk Register]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hazard: { type: string }
   *               severity: { type: string, enum: [Low, Medium, High, Critical] }
   *               likelihood: { type: string, enum: [Rare, Unlikely, Possible, Likely, Almost Certain] }
   *               mitigation: { type: string }
   *               status: { type: string, enum: [Identified, In Progress, Mitigated, Closed] }
   *               ownerId: { type: integer }
   *               reviewDate: { type: string, format: date }
   *     responses:
   *       200:
   *         description: Risk updated
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Risk'
   *       404:
   *         description: Risk not found
   *
   *   delete:
   *     summary: Delete a risk
   *     tags: [Risk Register]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200:
   *         description: Risk deleted successfully
   *       404:
   *         description: Risk not found
   */

  // Permissions
  router.post("/", verifyToken, hasPermission("risk:create"), riskController.createRisk);
  router.get("/", verifyToken, hasPermission("risk:view"), riskController.getAllRisks);
  router.put("/:id", verifyToken, hasPermission("risk:update"), riskController.updateRisk);
  router.delete("/:id", verifyToken, hasPermission("risk:delete"), riskController.deleteRisk);

  app.use("/api/risk", router);
};
