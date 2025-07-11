const express = require("express");
const logController = require("../controllers/worklog.controller");
const auth = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Work Logs
   *     description: Work log tracking endpoints
   */

  /**
   * @swagger
   * /api/logs/me:
   *   post:
   *     summary: Log work for the current user
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
   *                 example: "2025-07-10"
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
   *                     taskId:
   *                       type: integer
   *                       example: 1
   *                     hoursWorked:
   *                       type: number
   *                       example: 4.5
   *                     description:
   *                       type: string
   *                       example: "Completed UI design for homepage"
   *                     date:
   *                       type: string
   *                       format: date
   *                       example: "2025-07-10"
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
   *                     Task:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         title:
   *                           type: string
   *                           example: "Design Homepage"
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
   *                 error:
   *                   type: string
   *                   example: "User not assigned to this project or task"
   *       404:
   *         description: Project or task not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Project or task not found"
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
  router.post("/me", auth.verifyToken, logController.logWork);

  /**
   * @swagger
   * /api/logs/me:
   *   get:
   *     summary: Get current user's work logs with optional filters
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
   *         example: "2025-07-10"
   *     responses:
   *       200:
   *         description: List of current user's work logs
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: integer
   *                     example: 1
   *                   userId:
   *                     type: integer
   *                     example: 1
   *                   projectId:
   *                     type: integer
   *                     example: 1
   *                   taskId:
   *                     type: integer
   *                     example: 1
   *                   hoursWorked:
   *                     type: number
   *                     example: 4.5
   *                   description:
   *                     type: string
   *                     example: "Completed UI design for homepage"
   *                   date:
   *                     type: string
   *                     format: date
   *                     example: "2025-07-10"
   *                   User:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       firstName:
   *                         type: string
   *                         example: "John"
   *                       lastName:
   *                         type: string
   *                         example: "Doe"
   *                       email:
   *                         type: string
   *                         example: "john.doe@example.com"
   *                   Project:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       name:
   *                         type: string
   *                         example: "Website Redesign"
   *                   Task:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       title:
   *                         type: string
   *                         example: "Design Homepage"
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
  router.get("/me", auth.verifyToken, logController.getUserLogs);

  /**
   * @swagger
   * /api/logs/me/search:
   *   get:
   *     summary: Search current user's work logs with filters
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
   *         example: "2025-07-10"
   *     responses:
   *       200:
   *         description: List of current user's work logs based on search criteria
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: integer
   *                     example: 1
   *                   userId:
   *                     type: integer
   *                     example: 1
   *                   projectId:
   *                     type: integer
   *                     example: 1
   *                   taskId:
   *                     type: integer
   *                     example: 1
   *                   hoursWorked:
   *                     type: number
   *                     example: 4.5
   *                   description:
   *                     type: string
   *                     example: "Completed UI design for homepage"
   *                   date:
   *                     type: string
   *                     format: date
   *                     example: "2025-07-10"
   *                   User:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       firstName:
   *                         type: string
   *                         example: "John"
   *                       lastName:
   *                         type: string
   *                         example: "Doe"
   *                       email:
   *                         type: string
   *                         example: "john.doe@example.com"
   *                   Project:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       name:
   *                         type: string
   *                         example: "Website Redesign"
   *                   Task:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       title:
   *                         type: string
   *                         example: "Design Homepage"
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
   *                   example: "Failed to search user logs"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/me/search", auth.verifyToken, logController.searchUserLogs);

  /**
   * @swagger
   * /api/logs/project/{projectId}:
   *   get:
   *     summary: Get all work logs for a specific project (Admin or Manager only)
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
   *     responses:
   *       200:
   *         description: List of work logs for the project
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: integer
   *                     example: 1
   *                   userId:
   *                     type: integer
   *                     example: 1
   *                   projectId:
   *                     type: integer
   *                     example: 1
   *                   taskId:
   *                     type: integer
   *                     example: 1
   *                   hoursWorked:
   *                     type: number
   *                     example: 4.5
   *                   description:
   *                     type: string
   *                     example: "Completed UI design for homepage"
   *                   date:
   *                     type: string
   *                     format: date
   *                     example: "2025-07-10"
   *                   User:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       firstName:
   *                         type: string
   *                         example: "John"
   *                       lastName:
   *                         type: string
   *                         example: "Doe"
   *                       email:
   *                         type: string
   *                         example: "john.doe@example.com"
   *                   Project:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       name:
   *                         type: string
   *                         example: "Website Redesign"
   *                   Task:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       title:
   *                         type: string
   *                         example: "Design Homepage"
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
   *                 error:
   *                   type: string
   *                   example: "Only admins or managers can view project logs"
   *       404:
   *         description: Project not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
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
  router.get(
    "/project/:projectId",
    auth.verifyToken,
    auth.isAdminOrManager,
    logController.getProjectLogs
  );

  /**
   * @swagger
   * /api/logs/{logId}:
   *   delete:
   *     summary: Delete a work log entry
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
   *         description: Access denied - User not authorized to delete this log
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized to delete this log"
   *       404:
   *         description: Work log not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
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
  router.delete("/:logId", auth.verifyToken, logController.deleteLog);

  app.use("/api/logs", router);
};
