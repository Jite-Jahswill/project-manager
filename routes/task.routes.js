const express = require("express");
const taskController = require("../controllers/task.controller");
const { verifyToken } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Tasks
   *     description: Task management endpoints
   *
   * components:
   *   schemas:
   *     Task:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         title:
   *           type: string
   *           example: "Design Homepage"
   *         description:
   *           type: string
   *           example: "Create wireframes and mockups for the homepage"
   *           nullable: true
   *         dueDate:
   *           type: string
   *           format: date-time
   *           example: "2025-07-20T00:00:00Z"
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
   *           example: "2025-07-19T20:23:00Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T20:23:00Z"
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
   */

  /**
   * @swagger
   * /api/tasks:
   *   post:
   *     summary: Create a new task
   *     description: Staff can create tasks assigned to themselves for projects they are part of. Admins and managers can create tasks for any user in the project's team.
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
   *                 description: ID of the user assigned to the task (must be part of the project's team; staff can only assign to themselves)
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
   *                   $ref: '#/components/schemas/Task'
   *       400:
   *         description: Missing required fields or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "title, projectId, and assignedTo are required"
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
   *         description: Forbidden - User not in project or staff attempting to assign to others
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Staff can only assign tasks to themselves"
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
   *                   example: "Error creating task"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/", verifyToken, taskController.createTask);

  /**
   * @swagger
   * /api/tasks/project/{projectId}:
   *   get:
   *     summary: Get all tasks for a specific project
   *     description: Staff can view their assigned tasks for a project they are part of. Admins and managers can view all tasks for the project.
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
   *       400:
   *         description: Invalid project ID or pagination parameters
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
   *         description: Forbidden - User not assigned to project
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "You are not assigned to this project"
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
   *                   example: "Error fetching tasks"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/project/:projectId", verifyToken, taskController.getProjectTasks);

  /**
   * @swagger
   * /api/tasks:
   *   get:
   *     summary: Get all tasks with optional filters
   *     description: Staff can view their assigned tasks. Admins and managers can view all tasks with optional filters.
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
   *         description: List of tasks matching the filters
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
   *       400:
   *         description: Invalid pagination parameters
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
   *                   example: "Error fetching tasks"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/", verifyToken, taskController.getAllTasks);

  /**
   * @swagger
   * /api/tasks/{taskId}/status:
   *   patch:
   *     summary: Update the status of a task
   *     description: Staff can update the status of their assigned tasks. Admins and managers can update the status of any task.
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
   *         description: Forbidden - Staff cannot update others' tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to update this task's status"
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
   *                   example: "Error updating task status"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.patch("/:taskId/status", verifyToken, taskController.updateTaskStatus);

  /**
   * @swagger
   * /api/tasks/{taskId}:
   *   patch:
   *     summary: Update task details
   *     description: Staff can update title, description, and dueDate of their assigned tasks. Admins and managers can update all fields of any task, including reassignment.
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
   *                 example: "Design Homepage Updated"
   *                 description: Updated task title
   *                 nullable: true
   *               description:
   *                 type: string
   *                 example: "Updated wireframes and mockups for the homepage"
   *                 description: Updated task description
   *                 nullable: true
   *               dueDate:
   *                 type: string
   *                 format: date-time
   *                 example: "2025-07-25T00:00:00Z"
   *                 description: Updated due date for the task (ISO 8601 format)
   *                 nullable: true
   *               assignedTo:
   *                 type: integer
   *                 example: 2
   *                 description: ID of the user to reassign the task to (admin/manager only, must be part of the project's team)
   *                 nullable: true
   *               status:
   *                 type: string
   *                 enum: ["To Do", "In Progress", "Review", "Done"]
   *                 example: "In Progress"
   *                 description: Updated task status
   *                 nullable: true
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
   *         description: Invalid input or no fields provided
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "At least one field is required for update"
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
   *         description: Forbidden - Staff cannot update others' tasks or reassign tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to update this task"
   *       404:
   *         description: Task or user not found
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
   *                   example: "Error updating task"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.patch("/:taskId", verifyToken, taskController.updateTask);

  /**
   * @swagger
   * /api/tasks/{taskId}:
   *   delete:
   *     summary: Delete a task
   *     description: Staff can delete their assigned tasks. Admins and managers can delete any task.
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
   *         description: Forbidden - Staff cannot delete others' tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to delete this task"
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
   *                   example: "Error deleting task"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:taskId", verifyToken, taskController.deleteTask);

  app.use("/api/tasks", router);
};
