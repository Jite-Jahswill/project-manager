const express = require("express");
const workLogController = require("../controllers/workLog.controller");
const { verifyToken } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: WorkLogs
   *     description: Work log management endpoints for logging, retrieving, updating, and deleting work logs.
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
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
   *           example: "Developed login page UI"
   *         date:
   *           type: string
   *           format: date
   *           example: "2025-10-26"
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-10-26T18:35:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-10-26T18:35:00.000Z"
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
   *               example: "Implement Login Page"

  /**
   * @swagger
   * /api/work-logs:
   *   post:
   *     summary: Create a new work log
   *     description: Logs work for a specific project and task. Accessible to any authenticated user.
   *     tags: [WorkLogs]
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
   *                 description: ID of the project
   *               taskId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the task
   *               hoursWorked:
   *                 type: number
   *                 example: 4.5
   *                 description: Number of hours worked
   *               description:
   *                 type: string
   *                 example: "Developed login page UI"
   *                 description: Description of the work done
   *               date:
   *                 type: string
   *                 format: date
   *                 example: "2025-10-26"
   *                 description: Date of the work (YYYY-MM-DD)
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
   *         description: Invalid input or task/project mismatch
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
  router.post("/", verifyToken, workLogController.logWork);

  /**
   * @swagger
   * /api/work-logs:
   *   get:
   *     summary: Get work logs
   *     description: Retrieves a paginated list of work logs with optional filters by userId, projectId, taskId, and date. Accessible to any authenticated user.
   *     tags: [WorkLogs]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: userId
   *         schema:
   *           type: integer
   *         required: false
   *         description: Filter logs by user ID
   *         example: 1
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
   *         example: "2025-10-26"
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
   *         description: List of work logs
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
   *                       example: 5
   *                     totalItems:
   *                       type: integer
   *                       example: 100
   *                     itemsPerPage:
   *                       type: integer
   *                       example: 20
   *       400:
   *         description: Invalid pagination or date format
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
  router.get("/", verifyToken, workLogController.getUserLogs);

  /**
   * @swagger
   * /api/work-logs/project/{projectId}:
   *   get:
   *     summary: Get work logs for a project
   *     description: Retrieves a paginated list of work logs for a specific project. Accessible to any authenticated user.
   *     tags: [WorkLogs]
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
   *         description: List of project work logs
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
   *                       example: 5
   *                     totalItems:
   *                       type: integer
   *                       example: 100
   *                     itemsPerPage:
   *                       type: integer
   *                       example: 20
   *       400:
   *         description: Invalid projectId or pagination
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
  router.get("/project/:projectId", verifyToken, workLogController.getProjectLogs);

  /**
   * @swagger
   * /api/work-logs/{logId}:
   *   put:
   *     summary: Update a work log
   *     description: Updates an existing work log by ID. Accessible to any authenticated user.
   *     tags: [WorkLogs]
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
   *                 example: 4.5
   *                 description: Number of hours worked
   *               description:
   *                 type: string
   *                 example: "Updated login page UI"
   *                 description: Description of the work done
   *               date:
   *                 type: string
   *                 format: date
   *                 example: "2025-10-26"
   *                 description: Date of the work (YYYY-MM-DD)
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
   *         description: Invalid input
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
  router.put("/:logId", verifyToken, workLogController.updateLog);

  /**
   * @swagger
   * /api/work-logs/{logId}:
   *   delete:
   *     summary: Delete a work log
   *     description: Deletes a work log by ID. Accessible to any authenticated user.
   *     tags: [WorkLogs]
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
  router.delete("/:logId", verifyToken, workLogController.deleteLog);

  app.use("/api/work-logs", router);
};
