const express = require("express");
const userController = require("../controllers/user.controller");
const { verifyToken, isAdminOrManager } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Users
   *     description: User management endpoints
   *
   * components:
   *   schemas:
   *     User:
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
   *         role:
   *           type: string
   *           example: "staff"
   *         image:
   *           type: string
   *           example: "uploads/profiles/user1.jpg"
   *           nullable: true
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T22:01:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T22:01:00.000Z"
   */

  /**
   * @swagger
   * /api/users:
   *   get:
   *     summary: Get all users (Admin or Manager only)
   *     description: Retrieves a list of all users with optional filters for role, firstName, or lastName. Only accessible to admins or managers.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: role
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter users by role (e.g., admin, manager, staff)
   *         example: "staff"
   *       - in: query
   *         name: firstName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter users by first name (partial match)
   *         example: "John"
   *       - in: query
   *         name: lastName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter users by last name (partial match)
   *         example: "Doe"
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
   *         description: Number of users per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of all users
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 users:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/User'
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
   *       403:
   *         description: Access denied - Only admins or managers can view all users
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can view all users"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch users"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/", verifyToken, isAdminOrManager, userController.getAllUsers);

  /**
   * @swagger
   * /api/users/{id}:
   *   get:
   *     summary: Get a single user by ID
   *     description: Retrieves a user's details. Staff can only view their own details; admins or managers can view any user's details.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
   *         example: 1
   *     responses:
   *       200:
   *         description: User details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/User'
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
   *         description: Access denied - Staff can only view their own details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Staff can only view their own details"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch user"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:id", verifyToken, userController.getUserById);

  /**
   * @swagger
   * /api/users/{userId}/projects:
   *   get:
   *     summary: Get all projects a user is assigned to
   *     description: Retrieves all projects a user is assigned to via their team(s). Staff can only view their own projects; admins or managers can view any user's projects.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
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
   *         description: Number of projects per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of projects the user is assigned to
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 projects:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       project:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           name:
   *                             type: string
   *                             example: "Website Redesign"
   *                           description:
   *                             type: string
   *                             example: "Redesign company website"
   *                             nullable: true
   *                       role:
   *                         type: string
   *                         example: "Developer"
   *                       note:
   *                         type: string
   *                         example: "Lead developer"
   *                         nullable: true
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
   *       403:
   *         description: Access denied - Staff can only view their own projects
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Staff can only view their own projects"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch user projects"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:userId/projects", verifyToken, userController.getUserProjects);

  /**
   * @swagger
   * /api/users/{userId}/tasks:
   *   get:
   *     summary: Get all tasks for the user's team(s)
   *     description: Retrieves all tasks associated with the user's team(s). Staff can only view their own tasks; admins or managers can view any user's tasks.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
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
   *         description: Number of tasks per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of tasks for the user's team(s)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tasks:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       title:
   *                         type: string
   *                         example: "Implement login feature"
   *                       description:
   *                         type: string
   *                         example: "Create a login feature for the application"
   *                       status:
   *                         type: string
   *                         example: "In Progress"
   *                       dueDate:
   *                         type: string
   *                         format: date
   *                         example: "2025-07-19"
   *                       project:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           name:
   *                             type: string
   *                             example: "Website Redesign"
   *                       team:
   *                         type: object
   *                         properties:
   *                           teamId:
   *                             type: integer
   *                             example: 1
   *                           teamName:
   *                             type: string
   *                             example: "Development Team"
   *                       assignee:
   *                         type: object
   *                         properties:
   *                           userId:
   *                             type: integer
   *                             example: 2
   *                           firstName:
   *                             type: string
   *                             example: "Jane"
   *                           lastName:
   *                             type: string
   *                             example: "Doe"
   *                           email:
   *                             type: string
   *                             example: "jane.doe@example.com"
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
   *       403:
   *         description: Access denied - Staff can only view their own tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Staff can only view their own tasks"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch user tasks"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:userId/tasks", verifyToken, userController.getUserTasks);

  app.use("/api/users", router);
};
