const express = require("express");
const userController = require("../controllers/user.controller");
const auth = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Users
   *     description: User management endpoints
   */

  /**
   * @swagger
   * /api/users:
   *   get:
   *     summary: Get all users (Admin only)
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
   *     responses:
   *       200:
   *         description: List of all users
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
   *                   firstName:
   *                     type: string
   *                     example: "John"
   *                   lastName:
   *                     type: string
   *                     example: "Doe"
   *                   email:
   *                     type: string
   *                     example: "john.doe@example.com"
   *                   role:
   *                     type: string
   *                     example: "staff"
   *                   image:
   *                     type: string
   *                     example: "uploads/profiles/user1.jpg"
   *                     nullable: true
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
   *         description: Access denied - Only admins can view all users
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Only admins can view all users"
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
  router.get(
    "/",
    auth.verifyToken,
    auth.isAdminOrManager,
    userController.getAllUsers
  );

  /**
   * @swagger
   * /api/users/{id}:
   *   get:
   *     summary: Get a single user by ID
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
   *               type: object
   *               properties:
   *                 id:
   *                   type: integer
   *                   example: 1
   *                 firstName:
   *                   type: string
   *                   example: "John"
   *                 lastName:
   *                   type: string
   *                   example: "Doe"
   *                 email:
   *                   type: string
   *                   example: "john.doe@example.com"
   *                 role:
   *                   type: string
   *                   example: "staff"
   *                 image:
   *                   type: string
   *                   example: "uploads/profiles/user1.jpg"
   *                   nullable: true
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
   *         description: Access denied - Unauthorized to view this user
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized to view this user"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
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
  router.get("/:id", auth.verifyToken, userController.getUserById);

  /**
   * @swagger
   * /api/users/{userId}/projects:
   *   get:
   *     summary: Get all projects a user is assigned to
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
   *     responses:
   *       200:
   *         description: List of projects the user is assigned to
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   project:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       name:
   *                         type: string
   *                         example: "Website Redesign"
   *                       description:
   *                         type: string
   *                         example: "Redesign company website"
   *                         nullable: true
   *                   role:
   *                     type: string
   *                     example: "Developer"
   *                   note:
   *                     type: string
   *                     example: "Lead developer"
   *                     nullable: true
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
   *         description: Access denied - Unauthorized to view this user's projects
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized to view this user's projects"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
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
  router.get(
    "/:userId/projects",
    auth.verifyToken,
    userController.getUserProjects
  );

  /**
   * @swagger
   * /api/users/{userId}/tasks:
   *   get:
   *     summary: Get all tasks for the user's team(s)
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
   *     responses:
   *       200:
   *         description: List of tasks for the user's team(s)
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
   *                   title:
   *                     type: string
   *                     example: "Implement login feature"
   *                   description:
   *                     type: string
   *                     example: "Create a login feature for the application"
   *                   status:
   *                     type: string
   *                     example: "In Progress"
   *                   dueDate:
   *                     type: string
   *                     format: date
   *                     example: "2025-07-30"
   *                   project:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       name:
   *                         type: string
   *                         example: "Website Redesign"
   *                   team:
   *                     type: object
   *                     properties:
   *                       teamId:
   *                         type: integer
   *                         example: 1
   *                       teamName:
   *                         type: string
   *                         example: "Development Team"
   *                   assignee:
   *                     type: object
   *                     properties:
   *                       userId:
   *                         type: integer
   *                         example: 2
   *                       firstName:
   *                         type: string
   *                         example: "Jane"
   *                       lastName:
   *                         type: string
   *                         example: "Doe"
   *                       email:
   *                         type: string
   *                         example: "jane.doe@example.com"
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
   *         description: Access denied - Unauthorized to view this user's tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized to view this user's tasks"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
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
  router.get(
    "/:userId/tasks",
    auth.verifyToken,
    userController.getUserTasks
  );

  app.use("/api/users", router);
};
