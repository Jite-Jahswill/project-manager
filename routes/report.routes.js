const express = require("express");
const reportController = require("../controllers/report.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Reports
   *     description: Report management endpoints
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *   schemas:
   *     Report:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         title:
   *           type: string
   *           example: "Weekly Progress Report"
   *         content:
   *           type: string
   *           example: "Summary of project milestones achieved this week"
   *         user:
   *           type: object
   *           properties:
   *             userId:
   *               type: integer
   *               example: 1
   *             firstName:
   *               type: string
   *               example: "John"
   *             lastName:
   *               type: string
   *               example: "Doe"
   *             email:
   *               type: string
   *               example: "john.doe@example.com"
   *         team:
   *           type: object
   *           nullable: true
   *           properties:
   *             teamId:
   *               type: integer
   *               example: 1
   *             name:
   *               type: string
   *               example: "Development Team"
   *         project:
   *           type: object
   *           properties:
   *             projectId:
   *               type: integer
   *               example: 1
   *             name:
   *               type: string
   *               example: "Website Redesign"
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T20:13:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T20:13:00.000Z"
   */

  /**
   * @swagger
   * /api/reports:
   *   post:
   *     summary: Create a new report
   *     description: Creates a new report associated with a project and optionally a team. Accessible to any authenticated user.
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
   *               - title
   *               - content
   *               - projectId
   *             properties:
   *               title:
   *                 type: string
   *                 example: "Weekly Progress Report"
   *                 description: Title of the report
   *               content:
   *                 type: string
   *                 example: "Summary of project milestones achieved this week"
   *                 description: Content of the report
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 nullable: true
   *                 description: ID of the team associated with the report
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project associated with the report
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
   *                   example: "Title is required"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       404:
   *         description: User, team, or project not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Project not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error creating report"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/", verifyToken, hasPermission("report:create"), reportController.createReport);

  /**
   * @swagger
   * /api/reports:
   *   get:
   *     summary: Get all reports with optional filters
   *     description: Retrieves a paginated list of all reports with optional filters for projectId, userName, and projectName. Accessible to any authenticated user.
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: projectId
   *         schema:
   *           type: integer
   *         required: false
   *         description: Filter reports by project ID
   *         example: 1
   *       - in: query
   *         name: userName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter reports by user's first or last name (partial match)
   *         example: "John"
   *       - in: query
   *         name: projectName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter reports by project name (partial match)
   *         example: "Website"
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         required: false
   *         description: Page number for pagination
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 20
   *         required: false
   *         description: Number of items per page
   *         example: 20
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
   *         description: Invalid page or limit
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Invalid page or limit"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error fetching reports"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/", verifyToken, hasPermission("report:read"), reportController.getAllReports);

  /**
   * @swagger
   * /api/reports/{id}:
   *   get:
   *     summary: Get a report by ID
   *     description: Retrieves a specific report by ID, including associated user and project details. Accessible to any authenticated user.
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
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       404:
   *         description: Report not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error retrieving report"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:id", verifyToken, hasPermission("report:read"), reportController.getReportById);

  /**
   * @swagger
   * /api/reports/{id}:
   *   put:
   *     summary: Update a report
   *     description: Updates a report's title and/or content and notifies admins and managers via email. Accessible to any authenticated user.
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
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title:
   *                 type: string
   *                 example: "Updated Weekly Progress Report"
   *                 description: New title for the report
   *               content:
   *                 type: string
   *                 example: "Updated summary of project milestones"
   *                 description: New content for the report
   *     responses:
   *       200:
   *         description: Report updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report updated successfully"
   *                 report:
   *                   $ref: '#/components/schemas/Report'
   *       400:
   *         description: No fields provided for update
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "At least one field (title, content) is required"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       404:
   *         description: Report not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error updating report"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:id", verifyToken, hasPermission("report:update"), reportController.updateReport);

  /**
   * @swagger
   * /api/reports/{id}:
   *   delete:
   *     summary: Delete a report
   *     description: Deletes a report and notifies admins, managers, and the report's creator via email. Accessible to any authenticated user.
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
   *         description: Report deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report deleted successfully"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       404:
   *         description: Report not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error deleting report"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:id", verifyToken, hasPermission("report:delete"), reportController.deleteReport);

  /**
   * @swagger
   * /api/reports/assign:
   *   post:
   *     summary: Assign a report to a user
   *     description: Assigns a report to a specified user and notifies admins, managers, and the assigned user via email. Accessible to any authenticated user.
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
   *               - reportId
   *               - userId
   *             properties:
   *               reportId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the report to assign
   *               userId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the user to assign the report to
   *     responses:
   *       200:
   *         description: Report assigned successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report assigned successfully"
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
   *                   example: "reportId and userId are required"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       404:
   *         description: Report or user not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error assigning report"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/assign", verifyToken, hasPermission("report:create"), reportController.assignReportToUser);

  app.use("/api/reports", router);
};
