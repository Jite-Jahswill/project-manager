const express = require("express");
const reportController = require("../controllers/report.controller");
const { verifyToken } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Reports
   *     description: Report management endpoints
   */

  /**
   * @swagger
   * /api/reports:
   *   post:
   *     summary: Create a new report
   *     description: Any authenticated user can create a report for any project.
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
   *               - projectId
   *               - title
   *               - content
   *             properties:
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project associated with the report
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the team associated with the report (optional)
   *               title:
   *                 type: string
   *                 example: "Weekly Progress Report"
   *                 description: Title of the report
   *               content:
   *                 type: string
   *                 example: "Completed UI design phase, started backend integration."
   *                 description: Detailed content of the report
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     title:
   *                       type: string
   *                       example: "Weekly Progress Report"
   *                     content:
   *                       type: string
   *                       example: "Completed UI design phase, started backend integration."
   *                     user:
   *                       type: object
   *                       properties:
   *                         userId:
   *                           type: integer
   *                           example: 1
   *                         firstName:
   *                           type: string
   *                           example: "John"
   *                         lastName:
   *                           type: string
   *                           example: "Doe"
   *                         email:
   *                           type: string
   *                           example: "john.doe@example.com"
   *                     team:
   *                       type: object
   *                       nullable: true
   *                       properties:
   *                         teamId:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Development Team"
   *                     project:
   *                       type: object
   *                       properties:
   *                         projectId:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Website Redesign"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-20T10:31:00Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-20T10:31:00Z"
   *       400:
   *         description: Missing required fields or invalid input
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
  router.post("/", verifyToken, reportController.createReport);

  /**
   * @swagger
   * /api/reports:
   *   get:
   *     summary: Get all reports
   *     description: Any authenticated user can view all reports with optional filters for projectId, userName, or projectName.
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
   *         description: Filter reports by user name (partial match on firstName or lastName)
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
   *           default: 1
   *         required: false
   *         description: Page number for pagination
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *         required: false
   *         description: Number of items per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of reports with pagination
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 reports:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       title:
   *                         type: string
   *                         example: "Weekly Progress Report"
   *                       content:
   *                         type: string
   *                         example: "Completed UI design phase, started backend integration."
   *                       user:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           firstName:
   *                             type: string
   *                             example: "John"
   *                           lastName:
   *                             type: string
   *                             example: "Doe"
   *                           email:
   *                             type: string
   *                             example: "john.doe@example.com"
   *                       team:
   *                         type: object
   *                         nullable: true
   *                         properties:
   *                           teamId:
   *                             type: integer
   *                             example: 1
   *                           name:
   *                             type: string
   *                             example: "Development Team"
   *                       project:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           name:
   *                             type: string
   *                             example: "Website Redesign"
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *                         example: "2025-07-20T10:31:00Z"
   *                       updatedAt:
   *                         type: string
   *                         format: date-time
   *                         example: "2025-07-20T10:31:00Z"
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
  router.get("/", verifyToken, reportController.getAllReports);

  /**
   * @swagger
   * /api/reports/{id}:
   *   get:
   *     summary: Get a report by ID
   *     description: Any authenticated user can view any report.
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     title:
   *                       type: string
   *                       example: "Weekly Progress Report"
   *                     content:
   *                       type: string
   *                       example: "Completed UI design phase, started backend integration."
   *                     user:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         firstName:
   *                           type: string
   *                           example: "John"
   *                         lastName:
   *                           type: string
   *                           example: "Doe"
   *                         email:
   *                           type: string
   *                           example: "john.doe@example.com"
   *                     team:
   *                       type: object
   *                       nullable: true
   *                       properties:
   *                         teamId:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Development Team"
   *                     project:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Website Redesign"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-20T10:31:00Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-20T10:31:00Z"
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
  router.get("/:id", verifyToken, reportController.getReportById);

  /**
   * @swagger
   * /api/reports/{id}:
   *   put:
   *     summary: Update a report
   *     description: Any authenticated user can update any report. At least one field (title or content) must be provided.
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
   *                 description: Updated title of the report (optional)
   *               content:
   *                 type: string
   *                 example: "Updated: Completed UI and backend integration."
   *                 description: Updated content of the report (optional)
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     title:
   *                       type: string
   *                       example: "Updated Weekly Progress Report"
   *                     content:
   *                       type: string
   *                       example: "Updated: Completed UI and backend integration."
   *                     user:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         firstName:
   *                           type: string
   *                           example: "John"
   *                         lastName:
   *                           type: string
   *                           example: "Doe"
   *                         email:
   *                           type: string
   *                           example: "john.doe@example.com"
   *                     team:
   *                       type: object
   *                       nullable: true
   *                       properties:
   *                         teamId:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Development Team"
   *                     project:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Website Redesign"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-20T10:31:00Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-20T10:32:00Z"
   *       400:
   *         description: Missing required fields
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
  router.put("/:id", verifyToken, reportController.updateReport);

  /**
   * @swagger
   * /api/reports/{id}:
   *   delete:
   *     summary: Delete a report
   *     description: Any authenticated user can delete any report.
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
  router.delete("/:id", verifyToken, reportController.deleteReport);

  /**
   * @swagger
   * /api/reports/assign:
   *   post:
   *     summary: Assign a report to a user
   *     description: Admins and managers can assign a report to any user.
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
   *                 example: 2
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     title:
   *                       type: string
   *                       example: "Weekly Progress Report"
   *                     content:
   *                       type: string
   *                       example: "Completed UI design phase, started backend integration."
   *                     user:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 2
   *                         firstName:
   *                           type: string
   *                           example: "Jane"
   *                         lastName:
   *                           type: string
   *                           example: "Smith"
   *                         email:
   *                           type: string
   *                           example: "jane.smith@example.com"
   *                     team:
   *                       type: object
   *                       nullable: true
   *                       properties:
   *                         teamId:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Development Team"
   *                     project:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Website Redesign"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-20T10:31:00Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-20T10:32:00Z"
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
   *       403:
   *         description: Forbidden - Only admins or managers can assign reports
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can assign reports"
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
  router.post("/assign", verifyToken, reportController.assignReportToUser);

  app.use("/api/reports", router);
};
