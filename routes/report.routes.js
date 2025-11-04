const express = require("express");
const reportController = require("../controllers/report.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Reports
   *     description: HSE-style incident and safety report management
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *
   *   schemas:
   *     UserSummary:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         firstName:
   *           type: string
   *           example: "John"
   *         lastName:
   *           type: string
   *           example: "Doe"
   *         email:
   *           type: string
   *           example: "john.doe@example.com"
   *
   *     ProjectSummary:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         name:
   *           type: string
   *           example: "Site Construction"
   *
   *     TeamSummary:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         name:
   *           type: string
   *           example: "Safety Team"
   *
   *     Report:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         dateOfReport:
   *           type: string
   *           format: date
   *           example: "2025-11-04"
   *           description: Date when the incident/report was recorded
   *         timeOfReport:
   *           type: string
   *           format: time
   *           example: "14:30:00"
   *           description: Time when the incident/report was recorded
   *         reporter:
   *           $ref: '#/components/schemas/UserSummary'
   *           description: User who submitted the report
   *         report:
   *           type: string
   *           description: Detailed long-text description of the incident or report
   *         supportingDocUrl:
   *           type: string
   *           nullable: true
   *           example: "https://storage.example.com/docs/report-1.pdf"
   *           description: Optional URL to supporting document (photo, PDF, etc.)
   *         status:
   *           type: string
   *           enum: [open, pending, closed]
   *           default: open
   *           example: "open"
   *           description: Current status of the report
   *         closedAt:
   *           type: string
   *           format: date-time
   *           nullable: true
   *           example: "2025-11-05T10:00:00.000Z"
   *           description: Timestamp when report was closed
   *         closer:
   *           $ref: '#/components/schemas/UserSummary'
   *           nullable: true
   *           description: User who closed the report
   *         project:
   *           $ref: '#/components/schemas/ProjectSummary'
   *           nullable: true
   *         team:
   *           $ref: '#/components/schemas/TeamSummary'
   *           nullable: true
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-11-04T14:30:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-11-04T14:30:00.000Z"
   */

  /**
   * @swagger
   * /api/reports:
   *   post:
   *     summary: Create a new HSE report
   *     description: Creates a new HSE incident/safety report. Accessible to any authenticated user.
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
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
   *                 example: "2025-11-04"
   *                 description: Date of the incident/report
   *               timeOfReport:
   *                 type: string
   *                 format: time
   *                 example: "14:30:00"
   *                 description: Time of the incident/report
   *               report:
   *                 type: string
   *                 description: Detailed description of the incident
   *               supportingDocUrl:
   *                 type: string
   *                 nullable: true
   *                 example: "https://storage.example.com/docs/incident-1.jpg"
   *                 description: Optional link to supporting evidence
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 nullable: true
   *                 description: Associated project ID
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 nullable: true
   *                 description: Associated team ID
   *     responses:
   *       201:
   *         description: Report created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report created"
   *                 report:
   *                   $ref: '#/components/schemas/Report'
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "dateOfReport, timeOfReport, and report are required"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *       404:
   *         description: Project or team not found
   *       500:
   *         description: Internal server error
   */
  router.post("/", verifyToken, hasPermission("report:create"), reportController.createReport);

  /**
   * @swagger
   * /api/reports:
   *   get:
   *     summary: Get all reports with filters
   *     description: Retrieves paginated list of reports with optional filters. Accessible to any authenticated user.
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: projectId
   *         schema:
   *           type: integer
   *         required: false
   *         description: Filter by project ID
   *         example: 1
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [open, pending, closed]
   *         required: false
   *         description: Filter by report status
   *         example: open
   *       - in: query
   *         name: reporterName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter by reporter's first or last name (partial match)
   *         example: John
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         required: false
   *         description: Page number
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 20
   *         required: false
   *         description: Items per page
   *     responses:
   *       200:
   *         description: List of reports
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 reports:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Report'
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     currentPage:
   *                       type: integer
   *                       example: 1
   *                     totalPages:
   *                       type: integer
   *                       example: 5
   *                     totalItems:
   *                       type: integer
   *                       example: 100
   *                     itemsPerPage:
   *                       type: integer
   *                       example: 20
   *       400:
   *         description: Invalid pagination parameters
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Internal server error
   */
  router.get("/", verifyToken, hasPermission("report:read"), reportController.getAllReports);

  /**
   * @swagger
   * /api/reports/{id}:
   *   get:
   *     summary: Get a report by ID
   *     description: Retrieves a single report with full associations.
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Report ID
   *         example: 1
   *     responses:
   *       200:
   *         description: Report details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 report:
   *                   $ref: '#/components/schemas/Report'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Report not found
   *       500:
   *         description: Internal server error
   */
  router.get("/:id", verifyToken, hasPermission("report:read"), reportController.getReportById);

  /**
   * @swagger
   * /api/reports/{id}:
   *   put:
   *     summary: Update a report
   *     description: Updates any field of the report. Status change to 'closed' auto-sets closedAt and closedBy.
   *     tags: [Reports]
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
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               dateOfReport:
   *                 type: string
   *                 format: date
   *               timeOfReport:
   *                 type: string
   *                 format: time
   *               report:
   *                 type: string
   *               supportingDocUrl:
   *                 type: string
   *                 nullable: true
   *               status:
   *                 type: string
   *                 enum: [open, pending, closed]
   *               closedBy:
   *                 type: integer
   *                 description: Required only if status=closed and different from current user
   *     responses:
   *       200:
   *         description: Report updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                 report:
   *                   $ref: '#/components/schemas/Report'
   *       400:
   *         description: No valid fields to update
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Report not found
   *       500:
   *         description: Internal server error
   */
  router.put("/:id", verifyToken, hasPermission("report:update"), reportController.updateReport);

  /**
   * @swagger
   * /api/reports/{id}:
   *   delete:
   *     summary: Delete a report
   *     description: Permanently deletes a report and notifies admins and reporter.
   *     tags: [Reports]
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
   *                   example: "Report deleted successfully"
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Report not found
   *       500:
   *         description: Internal server error
   */
  router.delete("/:id", verifyToken, hasPermission("report:delete"), reportController.deleteReport);

  /**
   * @swagger
   * /api/reports/{id}/close:
   *   patch:
   *     summary: Close a report
   *     description: Marks a report as closed, sets closedAt and closedBy. Only open/pending reports can be closed.
   *     tags: [Reports]
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
   *         description: Report closed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report closed"
   *                 report:
   *                   $ref: '#/components/schemas/Report'
   *       400:
   *         description: Report already closed
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Report not found
   *       500:
   *         description: Internal server error
   */
  router.patch("/:id/close", verifyToken, hasPermission("report:close"), reportController.closeReport);

  app.use("/api/reports", router);
};
