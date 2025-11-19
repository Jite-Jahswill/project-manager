// routes/auditor.routes.js
const express = require("express");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const auditorController = require("../controllers/auditor.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Audit Schedule
   *     description: Manage internal safety audit schedules and inspector assignments
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *
   *   schemas:
   *     Audit:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *         title:
   *           type: string
   *           example: "Q4 Warehouse Safety Audit"
   *         date:
   *           type: string
   *           format: date
   *           example: "2025-03-15"
   *         area:
   *           type: string
   *           example: "Main Warehouse & Loading Bay"
   *         inspectors:
   *           type: array
   *           items:
   *             type: string
   *           example: ["John Doe", "Jane Smith"]
   *         createdAt:
   *           type: string
   *           format: date-time
   *         updatedAt:
   *           type: string
   *           format: date-time
   *
   *     Pagination:
   *       type: object
   *       properties:
   *         total:
   *           type: integer
   *         page:
   *           type: integer
   *         totalPages:
   *           type: integer
   *         itemsPerPage:
   *           type: integer
   *
   * /api/audit:
   *   post:
   *     summary: Create a new audit schedule
   *     tags: [Audit Schedule]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - title
   *               - date
   *               - area
   *             properties:
   *               title:
   *                 type: string
   *                 example: "Q4 Warehouse Safety Audit"
   *               date:
   *                 type: string
   *                 format: date
   *                 example: "2025-03-15"
   *               area:
   *                 type: string
   *                 example: "Main Warehouse & Loading Bay"
   *               inspectors:
   *                 oneOf:
   *                   - type: string
   *                     example: "John Doe"
   *                   - type: array
   *                     items:
   *                       type: string
   *                     example: ["John Doe", "Jane Smith"]
   *                 description: Single name or array of inspector names
   *     responses:
   *       201:
   *         description: Audit created successfully
   *       400:
   *         description: Missing required fields
   *       403:
   *         description: Insufficient permissions
   *
   *   get:
   *     summary: Get all audits with search and pagination
   *     tags: [Audit Schedule]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search in title, area, or inspector names
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *     responses:
   *       200:
   *         description: List of audits
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 audits:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Audit'
   *                 pagination:
   *                   $ref: '#/components/schemas/Pagination'
   *
   * /api/audit/{id}:
   *   put:
   *     summary: Update an existing audit (raw MySQL)
   *     tags: [Audit Schedule]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title:
   *                 type: string
   *               date:
   *                 type: string
   *                 format: date
   *               area:
   *                 type: string
   *               inspectors:
   *                 oneOf:
   *                   - type: string
   *                   - type: array
   *                     items:
   *                       type: string
   *     responses:
   *       200:
   *         description: Audit updated successfully
   *       404:
   *         description: Audit not found
   *
   *   delete:
   *     summary: Delete an audit schedule
   *     tags: [Audit Schedule]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Audit deleted successfully
   */

  // === PERMISSIONS ===
  const perms = {
    create: "audit:schedule",
    read:   "audit:view",
    update: "audit:schedule",
    delete: "audit:schedule",
  };

  router.post("/", verifyToken, hasPermission(perms.create), auditorController.createAudit);
  router.get("/",  verifyToken, hasPermission(perms.read),   auditorController.getAllAudits);
  router.put("/:id", verifyToken, hasPermission(perms.update), auditorController.updateAudit);
  router.delete("/:id", verifyToken, hasPermission(perms.delete), auditorController.deleteAudit);

  app.use("/api/audit", router);
};
