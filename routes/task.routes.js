const express = require("express");
const taskController = require("../controllers/task.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Tasks
   *     description: Task management endpoints for creating, retrieving, updating, and deleting tasks.
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *   schemas:
   *     Task:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         title:
   *           type: string
   *           example: "Implement Login Page"
   *         description:
   *           type: string
   *           example: "Develop and test the login page UI"
   *           nullable: true
   *         dueDate:
   *           type: string
   *           format: date-time
   *           example: "2025-11-01T23:59:59.000Z"
   *           nullable: true
   *         projectId:
   *           type: integer
   *           example: 1
   *         assignedTo:
   *           type: integer
   *           example: 1
   *         status:
   *           type: string
   *           enum: ["To Do", "In Progress", "Review", "Done"]
   *           example: "To Do"
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-10-26T16:50:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-10-26T16:50:00.000Z"
   *         project:
   *           type: object
   *           properties:
   *             id:
   *               type: integer
   *               example: 1
   *             name:
   *               type: string
   *               example: "Website Redesign"
   *         assignee:
   *           type: object
   *           properties:
   *             id:
   *               type: integer
   *               example: 1
   *             name:
   *               type: string
   *               example: "John Doe"
   *             email:
   *               type: string
   *               example: "john.doe@example.com"
   *     ErrorResponse:
   *       type: object
   *       properties:
   *         message:
   *           type: string
   *         details:
   *           type: string
   *           nullable: true
   */

  /**
   * @swagger
   * /api/tasks:
   *   post:
   *     summary: Create a new task
   *     description: Creates a new task associated with a project and assigned to a user. Accessible to any authenticated user. The assigned user must be part of the project's team. Sends email notifications to admins, managers, and the assigned user.
   *     tags: [Tasks]
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
   *               - projectId
   *               - assignedTo
   *             properties:
   *               title:
   *                 type: string
   *                 example: "Implement Login Page"
   *                 description: Title of the task
   *               description:
   *                 type: string
   *                 example: "Develop and test the login page UI"
   *                 description: Description of the task
   *                 nullable: true
   *               dueDate:
   *                 type: string
   *                 format: date-time
   *                 example: "2025-11-01T23:59:59.000Z"
   *                 description: Due date for the task
   *                 nullable: true
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project associated with the task
   *               assignedTo:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the user assigned to the task
   *               status:
   *                 type: string
   *                 enum: ["To Do", "In Progress", "Review", "Done"]
   *                 example: "To Do"
   *                 description: Status of the task
   *     responses:
   *       201:
   *         description: Task created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Task created successfully"
   *                 task:
   *                   $ref: '#/components/schemas/Task'
   *       400:
   *         description: Invalid input (e.g., missing required fields or assigned user not in project team)
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               examples:
   *                 missingFields:
   *                   summary: Missing required fields
   *                   value:
   *                     message: "title, projectId, and assignedTo are required"
   *                 invalidTeam:
   *                   summary: Assigned user not in project team
   *                   value:
   *                     message: "Assigned user is not part of the project's team"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Unauthorized"
   *       404:
   *         description: Project or assigned user not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Project not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Error creating task"
   *                 details: "Database error"
   */
  router.post("/", verifyToken, hasPermission("task:create"), taskController.createTask);

  /**
   * @swagger
   * /api/tasks/project/{projectId}:
   *   get:
   *     summary: Get all tasks for a specific project
   *     description: Retrieves a paginated list of tasks for a given project. Accessible to any authenticated user.
   *     tags: [Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         required: true
   *         schema:
   *           type: integer
   *         description: ID of the project
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
   *         description: List of tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tasks:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Task'
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
   *         description: Invalid projectId or pagination parameters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "projectId is required"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Unauthorized"
   *       404:
   *         description: Project not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Project not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Error fetching tasks"
   *                 details: "Database error"
   */
  router.get("/project/:projectId", verifyToken, hasPermission("task:read"), taskController.getProjectTasks);

  /**
   * @swagger
   * /api/tasks:
   *   get:
   *     summary: Get all tasks with optional filters
   *     description: Retrieves a paginated list of all tasks with optional filters for title, status, dueDate, and assigneeEmail. Accessible to any authenticated user.
   *     tags: [Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: title
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter tasks by title (partial match)
   *         example: "Login"
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: ["To Do", "In Progress", "Review", "Done"]
   *         required: false
   *         description: Filter tasks by status
   *         example: "In Progress"
   *       - in: query
   *         name: dueDate
   *         schema:
   *           type: string
   *           format: date-time
   *         required: false
   *         description: Filter tasks by due date
   *         example: "2025-11-01T23:59:59.000Z"
   *       - in: query
   *         name: assigneeEmail
   *         schema:
   *           type: string
   *           format: email
   *         required: false
   *         description: Filter tasks by assignee's email
   *         example: "john.doe@company.com"
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
   *         description: List of tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tasks:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Task'
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
   *         description: Invalid pagination or filter parameters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               message: "Invalid page or limit"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               message: "Unauthorized"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               message: "Error fetching tasks"
   *               details: "Database error"
   */
  router.get("/", verifyToken, hasPermission("task:read"), taskController.getAllTasks);

  /**
   * @swagger
   * /api/tasks/{taskId}/status:
   *   put:
   *     summary: Update a task's status
   *     description: Updates the status of a task and sends email notifications to admins, managers, and the assignee. Accessible to any authenticated user.
   *     tags: [Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Task ID
   *         example: 1
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - status
   *             properties:
   *               status:
   *                 type: string
   *                 enum: ["To Do", "In Progress", "Review", "Done"]
   *                 example: "In Progress"
   *                 description: New status for the task
   *     responses:
   *       200:
   *         description: Task status updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Task status updated successfully"
   *                 task:
   *                   $ref: '#/components/schemas/Task'
   *       400:
   *         description: Invalid status or missing parameters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Status is required"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Unauthorized"
   *       404:
   *         description: Task not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Task not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Error updating task status"
   *                 details: "Database error"
   */
  router.put("/:taskId/status", verifyToken, hasPermission("task:update"), taskController.updateTaskStatus);

  /**
   * @swagger
   * /api/tasks/{taskId}:
   *   put:
   *     summary: Update a task
   *     description: Updates a task's details (title, description, dueDate, assignedTo, status) and sends email notifications to admins, managers, and the assignee. Accessible to any authenticated user. The assigned user must be part of the project's team.
   *     tags: [Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Task ID
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
   *                 example: "Updated Login Page"
   *                 description: New title for the task
   *               description:
   *                 type: string
   *                 example: "Updated description for login page UI"
   *                 description: New description for the task
   *                 nullable: true
   *               dueDate:
   *                 type: string
   *                 format: date-time
   *                 example: "2025-11-01T23:59:59.000Z"
   *                 description: New due date for the task
   *                 nullable: true
   *               assignedTo:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the new user assigned to the task
   *               status:
   *                 type: string
   *                 enum: ["To Do", "In Progress", "Review", "Done"]
   *                 example: "In Progress"
   *                 description: New status for the task
   *     responses:
   *       200:
   *         description: Task updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Task updated successfully"
   *                 task:
   *                   $ref: '#/components/schemas/Task'
   *       400:
   *         description: Invalid input (e.g., no fields provided or assigned user not in project team)
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               examples:
   *                 noFields:
   *                   summary: No fields provided
   *                   value:
   *                     message: "At least one field is required for update"
   *                 invalidTeam:
   *                   summary: Assigned user not in project team
   *                   value:
   *                     message: "Assigned user is not part of the project's team"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Unauthorized"
   *       404:
   *         description: Task or assigned user not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Task not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Error updating task"
   *                 details: "Database error"
   */
  router.put("/:taskId", verifyToken, hasPermission("task:update"), taskController.updateTask);

  /**
   * @swagger
   * /api/tasks/{taskId}:
   *   delete:
   *     summary: Delete a task
   *     description: Deletes a task and sends email notifications to admins, managers, and the assignee (excluding the deleter). Accessible to any authenticated user.
   *     tags: [Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Task ID
   *         example: 1
   *     responses:
   *       200:
   *         description: Task deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Task deleted successfully"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Unauthorized"
   *       404:
   *         description: Task not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Task not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Error deleting task"
   *                 details: "Database error"
   */
  router.delete("/:taskId", verifyToken, hasPermission("task:delete"), taskController.deleteTask);

  /**
   * @swagger
   * /api/tasks/{taskId}/assign:
   *   post:
   *     summary: Assign a task to a user
   *     description: Assigns a task to a specified user and sends email notifications to admins, managers, and the assignee. Accessible to any authenticated user. The assigned user must be part of the project's team.
   *     tags: [Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Task ID
   *         example: 1
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - assignedTo
   *             properties:
   *               assignedTo:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the user to assign the task to
   *     responses:
   *       200:
   *         description: Task assigned successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Task assigned successfully"
   *                 task:
   *                   $ref: '#/components/schemas/Task'
   *       400:
   *         description: Invalid input (e.g., missing taskId or assignedTo, or assigned user not in project team)
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               examples:
   *                 missingFields:
   *                   summary: Missing required fields
   *                   value:
   *                     message: "taskId and assignedTo are required"
   *                 invalidTeam:
   *                   summary: Assigned user not in project team
   *                   value:
   *                     message: "Assigned user is not part of the project's team"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Unauthorized"
   *       404:
   *         description: Task or assigned user not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Task not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Error assigning task"
   *                 details: "Database error"
   */
  router.post("/:taskId/assign", verifyToken, hasPermission("task:create"), taskController.assignTask);

  /**
   * @swagger
   * /api/tasks/{taskId}:
   *   get:
   *     summary: Get a task by ID with optional filters
   *     description: Retrieves a specific task by ID with optional filters for title and assignee email. Accessible to any authenticated user.
   *     tags: [Tasks]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: taskId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Task ID
   *         example: 1
   *       - in: query
   *         name: title
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter by task title (partial match)
   *         example: "Login"
   *       - in: query
   *         name: assigneeEmail
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter by assignee email (partial match)
   *         example: "john.doe"
   *     responses:
   *       200:
   *         description: Task details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 task:
   *                   $ref: '#/components/schemas/Task'
   *       400:
   *         description: Invalid taskId or filter parameters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "taskId is required"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Unauthorized"
   *       404:
   *         description: Task not found or does not match filters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Task not found or does not match filters"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *               example:
   *                 message: "Error fetching task"
   *                 details: "Database error"
   */
  router.get("/:taskId", verifyToken, hasPermission("task:read"), taskController.getTaskById);

  app.use("/api/tasks", router);
};
