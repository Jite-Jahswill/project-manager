const express = require("express");
const logController = require("../controllers/worklog.controller");
const { verifyToken } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Work Logs
   *     description: Work log tracking endpoints
   *
   * components:
   *   schemas:
   *     WorkLog:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         userId:
   *           type: integer
   *           example: 1
   *         projectId:
   *           type: integer
   *           example: 1
   *         taskId:
   *           type: integer
   *           example: 1
   *         hoursWorked:
   *           type: number
   *           example: 4.5
   *         description:
   *           type: string
   *           example: "Completed UI design for homepage"
   *         date:
   *           type: string
   *           format: date
   *           example: "2025-07-19"
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T21:51:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T21:51:00.000Z"
   *         User:
   *           type: object
   *           properties:
   *             id:
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
   *         Project:
   *           type: object
   *           properties:
   *             id:
   *               type: integer
   *               example: 1
   *             name:
   *               type: string
   *               example: "Website Redesign"
   *         Task:
   *           type: object
   *           properties:
   *             id:
   *               type: integer
   *               example: 1
   *             title:
   *               type: string
   *               example: "Design Homepage"
   */

  /**
   * @swagger
   * /api/logs/me:
   *   post:
   *     summary: Log work for the current user
   *     description: Allows authenticated users (staff, admins, managers) to log work for tasks/projects they are assigned to.
   *     tags: [Work Logs]
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
   *               - taskId
   *               - hoursWorked
   *               - description
   *               - date
   *             properties:
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project associated with the work log
   *               taskId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the task associated with the work log
   *               hoursWorked:
   *                 type: number
   *                 example: 4.5
   *                 description: Number of hours worked (decimal, e.g., 4.5 for 4 hours 30 minutes)
   *               description:
   *                 type: string
   *                 example: "Completed UI design for homepage"
   *                 description: Description of the work performed
   *               date:
   *                 type: string
   *                 format: date
   *                 example: "2025-07-19"
   *                 description: Date the work was performed (YYYY-MM-DD)
   *     responses:
   *       201:
   *         description: Work log created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Work log created successfully"
   *                 log:
   *                   $ref: '#/components/schemas/WorkLog'
   *       400:
   *         description: Missing required fields or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "projectId, taskId, hoursWorked, description, and date are required"
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
   *         description: Access denied - User not assigned to project or task
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User not assigned to this project or task"
   *       404:
   *         description: Project or task not found
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
   *                 error:
   *                   type: string
   *                   example: "Failed to create work log"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/me", verifyToken, logController.logWork);

  /**
   * @swagger
   * /api/logs/me:
   *   get:
   *     summary: Get current user's work logs with optional filters
   *     description: Retrieves work logs for the authenticated user, with optional filters for project, task, or date.
   *     tags: [Work Logs]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: projectId
   *         schema:
   *           type: integer
   *         required: false
   *         description: Filter logs by project ID
   *         example: 1
   *       - in: query
   *         name: taskId
   *         schema:
   *           type: integer
   *         required: false
   *         description: Filter logs by task ID
   *         example: 1
   *       - in: query
   *         name: date
   *         schema:
   *           type: string
   *           format: date
   *         required: false
   *         description: Filter logs by date (YYYY-MM-DD)
   *         example: "2025-07-19"
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         description: Page number for pagination
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 20
   *         description: Number of logs per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of current user's work logs
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 logs:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/WorkLog'
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     currentPage:
   *                       type: integer
   *                       example: 1
   *                     totalPages:
   *                       type: integer
   *                       example: 1
   *                     totalItems:
   *                       type: integer
   *                       example: 10
   *                     itemsPerPage:
   *                       type: integer
   *                       example: 20
   *       400:
   *         description: Invalid page, limit, or date format
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
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch user logs"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/me", verifyToken, logController.getUserLogs);

  /**
   * @swagger
   * /api/logs/project/{projectId}:
   *   get:
   *     summary: Get all work logs for a specific project (Admin or Manager only)
   *     description: Retrieves all work logs for a project. Accessible only to admins or managers.
   *     tags: [Work Logs]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Project ID
   *         example: 1
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         description: Page number for pagination
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 20
   *         description: Number of logs per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of work logs for the project
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 logs:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/WorkLog'
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     currentPage:
   *                       type: integer
   *                       example: 1
   *                     totalPages:
   *                       type: integer
   *                       example: 1
   *                     totalItems:
   *                       type: integer
   *                       example: 10
   *                     itemsPerPage:
   *                       type: integer
   *                       example: 20
   *       400:
   *         description: Missing or invalid projectId, page, or limit
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "projectId is required"
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
   *         description: Access denied - Only admins or managers can view project logs
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can view project logs"
   *       404:
   *         description: Project not found
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
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch project logs"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/project/:projectId", verifyToken, logController.getProjectLogs);

  /**
   * @swagger
   * /api/logs/{logId}:
   *   put:
   *     summary: Update a work log entry
   *     description: Allows staff to update their own work logs and admins/managers to update any work log.
   *     tags: [Work Logs]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: logId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Work log ID
   *         example: 1
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hoursWorked:
   *                 type: number
   *                 example: 5.0
   *                 description: Updated number of hours worked
   *               description:
   *                 type: string
   *                 example: "Updated UI design for homepage"
   *                 description: Updated description of the work performed
   *               date:
   *                 type: string
   *                 format: date
   *                 example: "2025-07-19"
   *                 description: Updated date the work was performed (YYYY-MM-DD)
   *     responses:
   *       200:
   *         description: Work log updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Work log updated successfully"
   *                 log:
   *                   $ref: '#/components/schemas/WorkLog'
   *       400:
   *         description: Missing or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "At least one field (hoursWorked, description, date) is required"
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
   *         description: Access denied - Staff not authorized to update this log
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to update this work log"
   *       404:
   *         description: Work log not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Work log not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to update work log"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:logId", verifyToken, logController.updateLog);

  /**
   * @swagger
   * /api/logs/{logId}:
   *   delete:
   *     summary: Delete a work log entry
   *     description: Allows staff to delete their own work logs and admins/managers to delete any work log.
   *     tags: [Work Logs]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: logId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Work log ID
   *         example: 1
   *     responses:
   *       200:
   *         description: Work log deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Work log deleted successfully"
   *       400:
   *         description: Missing logId
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "logId is required"
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
   *         description: Access denied - Staff not authorized to delete this log
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to delete this work log"
   *       404:
   *         description: Work log not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Work log not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to delete work log"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:logId", verifyToken, logController.deleteLog);

  app.use("/api/logs", router);
};
