// routes/risk.routes.js
const express = require("express");
const { verifyToken,hasPermission } = require("../middlewares/auth.middleware");
const riskController = require("../controllers/risk.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Risk Register
   *     description: Manage workplace hazards and mitigation plans
   *
   * /api/risk:
   *   post:
   *     summary: Create new risk
   *     tags: [Risk Register]
   *     security: [bearerAuth: []]
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
   *       201: { description: Risk created }
   *
   *   get:
   *     summary: Get all risks (search + pagination)
   *     tags: [Risk Register]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200:
   *         description: List of risks
   *
   * /api/risk/{id}:
   *   put:
   *     summary: Update risk (raw MySQL)
   *     tags: [Risk Register]
   *     security: [bearerAuth: []]
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
   *               status: { type: string }
   *               ownerId: { type: integer }
   *     responses:
   *       200: { description: Risk updated }
   *
   *   delete:
   *     summary: Delete risk
   *     tags: [Risk Register]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Risk deleted }
   */

  router.post("/", verifyToken, hasPermission("risk:create"), riskController.createRisk);
  router.get("/", verifyToken, hasPermission("risk:read"), riskController.getAllRisks);
  router.put("/:id", verifyToken, hasPermission("risk:update"), riskController.updateRisk);
  router.delete("/:id", verifyToken, hasPermission("risk:delete"), riskController.deleteRisk);

  app.use("/api/risk", router);
};
