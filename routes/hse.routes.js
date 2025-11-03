// routes/hse.routes.js
const express = require("express");
const hseController = require("../controllers/hse.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const { upload } = require("../middlewares/upload.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * /api/hse/report:
   *   post:
   *     summary: Submit a new HSE incident report
   *     description: Allows authenticated users to submit an HSE report. Users can either upload a new file OR reference an existing document via `documentId`.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required:
   *               - dateOfReport
   *               - timeOfReport
   *               - report
   *             properties:
   *               dateOfReport:
   *                 type: string
   *                 format: date
   *                 example: "2025-04-05"
   *                 description: Date when the incident was reported
   *               timeOfReport:
   *                 type: string
   *                 format: time
   *                 example: "14:30:00"
   *                 description: Time when the incident was reported
   *               report:
   *                 type: string
   *                 example: "Slippery floor near entrance caused near-miss fall. Caution signs missing."
   *                 description: Detailed description of the incident
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: Optional. Upload new evidence (photo, PDF, etc.)
   *               documentId:
   *                 type: integer
   *                 example: 42
   *                 description: Optional. Reuse an existing document from the Documents table. Cannot be used with `file`.
   *     responses:
   *       201:
   *         description: HSE report submitted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "HSE report submitted"
   *                 hseReport:
   *                   $ref: '#/components/schemas/HSEReport'
   *       400:
   *         description: Missing required fields or both file and documentId provided
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *       404:
   *         description: Document not found (if documentId is invalid)
   *       500:
   *         description: Server error
   */
  router.post(
    "/report",
    verifyToken,
    upload,
    hseController.createHSEReport
  );

  /**
   * @swagger
   * /api/hse/reports:
   *   get:
   *     summary: Get all HSE reports (admin access)
   *     description: Returns a paginated list of all HSE reports with optional filtering by status and search.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *         description: Page number for pagination
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *         description: Number of reports per page
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search in report text or reporter name
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [open, pending, closed]
   *         description: Filter by report status
   *     responses:
   *       200:
   *         description: List of HSE reports with pagination
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 hseReports:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/HSEReport'
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     currentPage:
   *                       type: integer
   *                     totalPages:
   *                       type: integer
   *                     totalItems:
   *                       type: integer
   *                     itemsPerPage:
   *                       type: integer
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden - Missing hse:read permission
   *       500:
   *         description: Server error
   */
  router.get(
    "/reports",
    verifyToken,
    hasPermission("hse:read"),
    hseController.getAllHSEReports
  );

  /**
   * @swagger
   * /api/hse/report/{id}:
   *   get:
   *     summary: Get a single HSE report by ID
   *     description: Retrieves full details of an HSE report including reporter and closer (if closed).
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 1
   *         description: ID of the HSE report
   *     responses:
   *       200:
   *         description: HSE report details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 hseReport:
   *                   $ref: '#/components/schemas/HSEReport'
   *       404:
   *         description: Report not found
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get("/report/:id", verifyToken, hseController.getHSEReport);

  /**
   * @swagger
   * /api/hse/report/{id}:
   *   put:
   *     summary: Update an HSE report (admin only)
   *     description: Update report details, status, or replace supporting document. Can use new file upload OR reference an existing document via `documentId`.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 1
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               report:
   *                 type: string
   *                 description: Updated incident description
   *               status:
   *                 type: string
   *                 enum: [open, pending, closed]
   *                 description: Update status (only admin)
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: Optional. Replace with new uploaded file
   *               documentId:
   *                 type: integer
   *                 example: 45
   *                 description: Optional. Replace with existing document. Cannot be used with `file`.
   *     responses:
   *       200:
   *         description: HSE report updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                 hseReport:
   *                   $ref: '#/components/schemas/HSEReport'
   *       400:
   *         description: Invalid input or both file and documentId used
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Missing hse:update permission
   *       404:
   *         description: Report or document not found
   *       500:
   *         description: Server error
   */
  router.put(
    "/report/:id",
    verifyToken,
    hasPermission("hse:update"),
    upload,
    hseController.updateHSEReport
  );

  /**
   * @swagger
   * /api/hse/report/{id}:
   *   delete:
   *     summary: Permanently delete an HSE report (admin only)
   *     description: Hard delete – removes report and file reference from database.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 1
   *     responses:
   *       200:
   *         description: Report deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report deleted permanently"
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Missing hse:delete permission
   *       404:
   *         description: Report not found
   *       500:
   *         description: Server error
   */
  router.delete(
    "/report/:id",
    verifyToken,
    hasPermission("hse:delete"),
    hseController.deleteHSEReport
  );

  app.use("/api/hse", router);
};
