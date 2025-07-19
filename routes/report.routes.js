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
   *     description: Staff can create reports for projects they are assigned to. Admins and managers can create reports for any project.
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
   *                   example: "Report created successfully"
   *                 report:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     userId:
   *                       type: integer
   *                       example: 1
   *                     projectId:
   *                       type: integer
   *                       example: 1
   *                     title:
   *                       type: string
   *                       example: "Weekly Progress Report"
   *                     content:
   *                       type: string
   *                       example: "Completed UI design phase, started backend integration."
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:15:00Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:15:00Z"
   *                     User:
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
   *                     Project:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Website Redesign"
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "projectId, title, and content are required"
   *       401:
   *         description: Unauthorized - Invalid or lacking a token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       403:
   *         description: Forbidden - User not assigned to project
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User not assigned to this project"
   *       404:
   *         description: Project or user not found
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
   *     description: Staff can view their own reports. Admins and managers can filter by projectId, userName, or projectName.
   *     tags: [Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: projectId
   *         schema:
   *           type: integer
   *         required: false
   *         description: Filter reports by project ID (admin/manager only)
   *         example: 1
   *       - in: query
   *         name: userName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter reports by user name (partial match on firstName or lastName, admin/manager only)
   *         example: "John"
   *       - in: query
   *         name: projectName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter reports by project name (partial match, admin/manager only)
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
   *         description: List of reports
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
   *                       userId:
   *                         type: integer
   *                         example: 1
   *                       projectId:
   *                         type: integer
   *                         example: 1
   *                       title:
   *                         type: string
   *                         example: "Weekly Progress Report"
   *                       content:
   *                         type: string
   *                         example: "Completed UI design phase, started backend integration."
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *                         example: "2025-07-19T20:15:00Z"
   *                       updatedAt:
   *                         type: string
   *                         format: date-time
   *                         example: "2025-07-19T20:15:00Z"
   *                       User:
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
   *                       Project:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           name:
   *                             type: string
   *                             example: "Website Redesign"
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
   *       401:
   *         description: Unauthorized - Invalid or lacking a token
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
   *     description: Staff can view their own reports. Admins and managers can view any report.
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
   *                     userId:
   *                       type: integer
   *                       example: 1
   *                     projectId:
   *                       type: integer
   *                       example: 1
   *                     title:
   *                       type: string
   *                       example: "Weekly Progress Report"
   *                     content:
   *                       type: string
   *                       example: "Completed UI design phase, started backend integration."
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:15:00Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:15:00Z"
   *                     User:
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
   *                     Project:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Website Redesign"
   *       401:
   *         description: Unauthorized - Invalid or lacking a token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       403:
   *         description: Forbidden - Staff cannot view others' reports
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to view this report"
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
   *     description: Staff can update their own reports. Admins and managers can update any report.
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
   *                 description: Updated title of the report
   *               content:
   *                 type: string
   *                 example: "Updated: Completed UI and backend integration."
   *                 description: Updated content of the report
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
   *                     userId:
   *                       type: integer
   *                       example: 1
   *                     projectId:
   *                       type: integer
   *                       example: 1
   *                     title:
   *                       type: string
   *                       example: "Updated Weekly Progress Report"
   *                     content:
   *                       type: string
   *                       example: "Updated: Completed UI and backend integration."
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:15:00Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:16:00Z"
   *                     User:
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
   *                     Project:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Website Redesign"
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
   *         description: Unauthorized - Invalid or lacking a token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       403:
   *         description: Forbidden - Staff cannot update others' reports
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to update this report"
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
   *     description: Staff can delete their own reports. Admins and managers can delete any report.
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
   *         description: Unauthorized - Invalid or lacking a token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       403:
   *         description: Forbidden - Staff cannot delete others' reports
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to delete this report"
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

  app.use("/api/reports", router);
};
