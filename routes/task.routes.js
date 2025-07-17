const express = require("express");
const taskController = require("../controllers/task.controller");
const auth = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Tasks
   *     description: Task management endpoints
   */

  /**
   * @swagger
   * /api/tasks:
   *   post:
   *     summary: Create a new task (Admin or Manager only)
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
   *                 example: "Design Homepage"
   *                 description: Title of the task
   *               description:
   *                 type: string
   *                 example: "Create wireframes and mockups for the homepage"
   *                 description: Optional description of the task
   *                 nullable: true
   *               dueDate:
   *                 type: string
   *                 format: date-time
   *                 example: "2025-07-20T00:00:00Z"
   *                 description: Optional due date for the task (ISO 8601 format)
   *                 nullable: true
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project associated with the task
   *               assignedTo:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the user assigned to the task (must be part of a team assigned to the project)
   *               status:
   *                 type: string
   *                 enum: ["To Do", "In Progress", "Review", "Done"]
   *                 example: "To Do"
   *                 description: Optional initial status of the task
   *                 nullable: true
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     title:
   *                       type: string
   *                       example: "Design Homepage"
   *                     description:
   *                       type: string
   *                       example: "Create wireframes and mockups for the homepage"
   *                       nullable: true
   *                     dueDate:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-20T00:00:00Z"
   *                       nullable: true
   *                     projectId:
   *                       type: integer
   *                       example: 1
   *                     assignedTo:
   *                       type: integer
   *                       example: 1
   *                     status:
   *                       type: string
   *                       example: "To Do"
   *                     project:
   *                       $ref: '#/components/schemas/Project'
   *                     assignee:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "John Doe"
   *                         email:
   *                           type: string
   *                           example: "john.doe@example.com"
   *                     team:
   *                       type: object
   *                       properties:
   *                         teamId:
   *                           type: integer
   *                           example: 1
   *                         name:
   *                           type: string
   *                           example: "Dev Team"
   *                         note:
   *                           type: string
   *                           example: "Team assignment"
   *                           nullable: true
   *             example:
   *               message: "Task created successfully"
   *               task:
   *                 id: 1
   *                 title: "Design Homepage"
   *                 description: "Create wireframes and mockups for the homepage"
   *                 dueDate: "2025-07-20T00:00:00Z"
   *                 projectId: 1
   *                 assignedTo: 1
   *                 status: "To Do"
   *                 project:
   *                   id: 1
   *                   name: "Website Redesign"
   *                 assignee:
   *                   id: 1
   *                   name: "John Doe"
   *                   email: "john.doe@example.com"
   *                 team:
   *                   teamId: 1
   *                   name: "Dev Team"
   *                   note: "Team assignment"
   *       400:
   *         description: Missing required fields, invalid input, or user not in project team
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Assigned user is not part of a team working on this project"
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
   *         description: Access denied - Only admins or managers can create tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can create tasks"
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
   *                   example: "Failed to create task"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post(
    "/",
    auth.verifyToken,
    auth.isAdminOrManager,
    taskController.createTask
  );

  /**
   * @swagger
   * /api/tasks/project/{projectId}:
   *   get:
   *     summary: Get all tasks for a specific project
   *     description: Admins and managers can view all tasks for a project. Staff can only view their assigned tasks.
   *     tags: [Tasks]
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
   *         description: Number of tasks per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of tasks for the project
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
   *                       example: 1
   *                     totalItems:
   *                       type: integer
   *                       example: 1
   *                     itemsPerPage:
   *                       type: integer
   *                       example: 20
   *             example:
   *               tasks:
   *                 - id: 1
   *                   title: "Design Homepage"
   *                   description: "Create wireframes and mockups for the homepage"
   *                   dueDate: "2025-07-20T00:00:00Z"
   *                   projectId: 1
   *                   assignedTo: 1
   *                   status: "To Do"
   *                   createdAt: "2025-07-11T12:00:00Z"
   *                   project:
   *                     id: 1
   *                     name: "Website Redesign"
   *                   assignee:
   *                     id: 1
   *                     name: "John Doe"
   *                     email: "john.doe@example.com"
   *               pagination:
   *                 currentPage: 1
   *                 totalPages: 1
   *                 totalItems: 1
   *                 itemsPerPage: 20
   *       400:
   *         description: Invalid project ID
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
   *                 message:
   *                   type: string
   *                   example: "Failed to fetch tasks"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get(
    "/project/:projectId",
    auth.verifyToken,
    taskController.getProjectTasks
  );

  /**
   * @swagger
   * /api/tasks:
   *   get:
   *     summary: Get all tasks with optional filters
   *     description: Admins and managers can view all tasks. Staff can only view their assigned tasks.
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
   *         example: "Design"
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: ["To Do", "In Progress", "Review", "Done"]
   *         required: false
   *         description: Filter tasks by status (exact match)
   *         example: "In Progress"
   *       - in: query
   *         name: dueDate
   *         schema:
   *           type: string
   *           format: date
   *         required: false
   *         description: Filter tasks by due date (exact match)
   *         example: "2025-07-20"
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
   *         description: Number of tasks per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of all tasks matching the filters
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
   *                       example: 1
   *                     totalItems:
   *                       type: integer
   *                       example: 1
   *                     itemsPerPage:
   *                       type: integer
   *                       example: 20
   *             example:
   *               tasks:
   *                 - id: 1
   *                   title: "Design Homepage"
   *                   description: "Create wireframes and mockups for the homepage"
   *                   dueDate: "2025-07-20T00:00:00Z"
   *                   projectId: 1
   *                   assignedTo: 1
   *                   status: "To Do"
   *                   createdAt: "2025-07-11T12:00:00Z"
   *                   project:
   *                     id: 1
   *                     name: "Website Redesign"
   *                   assignee:
   *                     id: 1
   *                     name: "John Doe"
   *                     email: "john.doe@example.com"
   *               pagination:
   *                 currentPage: 1
   *                 totalPages: 1
   *                 totalItems: 1
   *                 itemsPerPage: 20
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
   *         description: Access denied - Only admins or managers can view all tasks; staff limited to own tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can view all tasks"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to fetch tasks"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get(
    "/",
    auth.verifyToken,
    taskController.getAllTasks
  );

  /**
   * @swagger
   * /api/tasks/{taskId}/status:
   *   put:
   *     summary: Update the status of a task (Admin or Manager only)
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
   *             example:
   *               message: "Task status updated successfully"
   *               task:
   *                 id: 1
   *                 title: "Design Homepage"
   *                 description: "Create wireframes and mockups for the homepage"
   *                 dueDate: "2025-07-20T00:00:00Z"
   *                 projectId: 1
   *                 assignedTo: 1
   *                 status: "In Progress"
   *                 createdAt: "2025-07-11T12:00:00Z"
   *                 updatedAt: "2025-07-12T12:00:00Z"
   *                 project:
   *                   id: 1
   *                   name: "Website Redesign"
   *                 assignee:
   *                   id: 1
   *                   name: "John Doe"
   *                   email: "john.doe@example.com"
   *       400:
   *         description: Invalid status or task ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Invalid status. Must be one of: To Do, In Progress, Review, Done"
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
   *         description: Access denied - Only admins or managers can update task status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can update task status"
   *       404:
   *         description: Task not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Task not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to update task status"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put(
    "/:taskId/status",
    auth.verifyToken,
    auth.isAdminOrManager,
    taskController.updateTaskStatus
  );

  /**
   * @swagger
   * /api/tasks/{taskId}:
   *   delete:
   *     summary: Delete a task (Admin or Manager only)
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
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       403:
   *         description: Access denied - Only admins or managers can delete tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can delete tasks"
   *       404:
   *         description: Task not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Task not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to delete task"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete(
    "/:taskId",
    auth.verifyToken,
    auth.isAdminOrManager,
    taskController.deleteTask
  );

  app.use("/api/tasks", router);
};
