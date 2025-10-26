const express = require("express");
const userController = require("../controllers/userController");
const { verifyToken } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Users
   *     description: User management endpoints for retrieving, updating, and deleting users, and fetching user projects and tasks.
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
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
   *         phoneNumber:
   *           type: string
   *           example: "+1234567890"
   *           nullable: true
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-10-26T16:50:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-10-26T16:50:00.000Z"
   *     UserDetailed:
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
   *         phoneNumber:
   *           type: string
   *           example: "+1234567890"
   *           nullable: true
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-10-26T16:50:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-10-26T16:50:00.000Z"
   *         teams:
   *           type: array
   *           items:
   *             type: object
   *             properties:
   *               teamId:
   *                 type: integer
   *                 example: 1
   *               teamName:
   *                 type: string
   *                 example: "Development Team"
   *                 nullable: true
   *               project:
   *                 type: object
   *                 nullable: true
   *                 properties:
   *                   id:
   *                     type: integer
   *                     example: 1
   *                   name:
   *                     type: string
   *                     example: "Website Redesign"
   *                   description:
   *                     type: string
   *                     example: "Redesign company website"
   *                     nullable: true
   *                   startDate:
   *                     type: string
   *                     format: date-time
   *                     example: "2025-10-01T00:00:00.000Z"
   *                     nullable: true
   *                   endDate:
   *                     type: string
   *                     format: date-time
   *                     example: "2025-12-31T23:59:59.000Z"
   *                     nullable: true
   *                   status:
   *                     type: string
   *                     example: "Active"
   *                     nullable: true
   *               role:
   *                 type: string
   *                 example: "Member"
   *               note:
   *                 type: string
   *                 example: "Frontend developer"
   *                 nullable: true
   *         tasks:
   *           type: array
   *           items:
   *             type: object
   *             properties:
   *               id:
   *                 type: integer
   *                 example: 1
   *               title:
   *                 type: string
   *                 example: "Implement Login Page"
   *               description:
   *                 type: string
   *                 example: "Develop login UI"
   *                 nullable: true
   *               status:
   *                 type: string
   *                 enum: ["To Do", "In Progress", "Review", "Done"]
   *                 example: "To Do"
   *               dueDate:
   *                 type: string
   *                 format: date-time
   *                 example: "2025-11-01T23:59:59.000Z"
   *                 nullable: true
   *               project:
   *                 type: object
   *                 nullable: true
   *                 properties:
   *                   id:
   *                     type: integer
   *                     example: 1
   *                   name:
   *                     type: string
   *                     example: "Website Redesign"
   *     ProjectWithRole:
   *       type: object
   *       properties:
   *         project:
   *           type: object
   *           properties:
   *             id:
   *               type: integer
   *               example: 1
   *             name:
   *               type: string
   *               example: "Website Redesign"
   *             description:
   *               type: string
   *               example: "Redesign company website"
   *               nullable: true
   *             startDate:
   *               type: string
   *               format: date-time
   *               example: "2025-10-01T00:00:00.000Z"
   *               nullable: true
   *             endDate:
   *               type: string
   *               format: date-time
   *               example: "2025-12-31T23:59:59.000Z"
   *               nullable: true
   *             status:
   *               type: string
   *               example: "Active"
   *               nullable: true
   *         role:
   *           type: string
   *           example: "Member"
   *         note:
   *           type: string
   *           example: "Frontend developer"
   *           nullable: true
   *     TaskWithDetails:
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
   *           example: "Develop login UI"
   *           nullable: true
   *         status:
   *           type: string
   *           enum: ["To Do", "In Progress", "Review", "Done"]
   *           example: "To Do"
   *         dueDate:
   *           type: string
   *           format: date-time
   *           example: "2025-11-01T23:59:59.000Z"
   *           nullable: true
   *         project:
   *           type: object
   *           properties:
   *             id:
   *               type: integer
   *               example: 1
   *             name:
   *               type: string
   *               example: "Website Redesign"
   *         team:
   *           type: object
   *           properties:
   *             teamId:
   *               type: integer
   *               example: 1
   *             teamName:
   *               type: string
   *               example: "Development Team"
   *         assignee:
   *           type: object
   *           nullable: true
   *           properties:
   *             userId:
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
   */

  /**
   * @swagger
   * /api/users/me:
   *   get:
   *     summary: Get current user's details
   *     description: Retrieves details of the authenticated user.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: User details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 user:
   *                   $ref: '#/components/schemas/User'
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
   *                 message:
   *                   type: string
   *                   example: "Failed to fetch user"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/me", verifyToken, userController.getCurrentUser);

  /**
   * @swagger
   * /api/users:
   *   get:
   *     summary: Get all users
   *     description: Retrieves a paginated list of all users with optional filters by role, firstName, and lastName. Accessible to any authenticated user.
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: role
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter users by role
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
   *         description: List of users
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 users:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/UserDetailed'
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
   *                   example: "Failed to fetch users"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/", verifyToken, userController.getAllUsers);

  /**
   * @swagger
   * /api/users/{id}:
   *   get:
   *     summary: Get a user by ID
   *     description: Retrieves details of a specific user by ID. Accessible to any authenticated user.
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
   *                 user:
   *                   $ref: '#/components/schemas/User'
   *       400:
   *         description: Missing or invalid user ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "id is required"
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
   *                 message:
   *                   type: string
   *                   example: "Failed to fetch user"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:id", verifyToken, userController.getUserById);

  /**
   * @swagger
   * /api/users/me:
   *   put:
   *     summary: Update current user's details
   *     description: Updates the authenticated user's details (firstName, lastName, email, phoneNumber).
   *     tags: [Users]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               firstName:
   *                 type: string
   *                 example: "John"
   *                 description: New first name
   *               lastName:
   *                 type: string
   *                 example: "Doe"
   *                 description: New last name
   *               email:
   *                 type: string
   *                 example: "john.doe@example.com"
   *                 description: New email address
   *               phoneNumber:
   *                 type: string
   *                 example: "+1234567890"
   *                 description: New phone number
   *                 nullable: true
   *     responses:
   *       200:
   *         description: User updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User updated"
   *                 user:
   *                   $ref: '#/components/schemas/User'
   *       400:
   *         description: Invalid input or no fields provided
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "At least one field is required"
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
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User not found"
   *       409:
   *         description: Email already in use
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Email already in use"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to update user"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/me", verifyToken, userController.updateCurrentUser);

  /**
   * @swagger
   * /api/users/{id}:
   *   delete:
   *     summary: Delete a user
   *     description: Deletes a specific user by ID. Accessible to any authenticated user.
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
   *         description: User deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User deleted successfully"
   *       400:
   *         description: Missing or invalid user ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "id is required"
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
   *                 message:
   *                   type: string
   *                   example: "Failed to delete user"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:id", verifyToken, userController.deleteCurrentUser);

  /**
   * @swagger
   * /api/users/{userId}/projects:
   *   get:
   *     summary: Get projects for a user
   *     description: Retrieves a paginated list of projects a user is associated with via teams. Accessible to any authenticated user.
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
   *         description: List of user projects
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 projects:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/ProjectWithRole'
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
   *         description: Invalid userId or pagination parameters
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "userId is required"
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
   *                 message:
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
   *     summary: Get tasks for a user
   *     description: Retrieves a paginated list of tasks associated with a user through their teams, with optional filters by title and assignee email. Accessible to any authenticated user.
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
   *       - in: query
   *         name: title
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter tasks by title (partial match)
   *         example: "Login"
   *       - in: query
   *         name: email
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter tasks by assignee email (partial match)
   *         example: "john.doe@example.com"
   *     responses:
   *       200:
   *         description: List of user tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 tasks:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/TaskWithDetails'
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
   *         description: Invalid userId or pagination parameters
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "userId is required"
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
   *                 message:
   *                   type: string
   *                   example: "Failed to fetch user tasks"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:userId/tasks", verifyToken, userController.getUserTasks);

  app.use("/api/users", router);
};
