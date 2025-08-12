const express = require("express");
const projectController = require("../controllers/project.controller");
const authMiddleware = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Projects
   *     description: Project management endpoints
   *
   * components:
   *   schemas:
   *     Project:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         name:
   *           type: string
   *           example: "Website Redesign"
   *         description:
   *           type: string
   *           example: "Redesign company website for better UX"
   *           nullable: true
   *         startDate:
   *           type: string
   *           format: date
   *           example: "2025-07-15"
   *           nullable: true
   *         endDate:
   *           type: string
   *           format: date
   *           example: "2025-12-31"
   *           nullable: true
   *         status:
   *           type: string
   *           enum: ["To Do", "In Progress", "Review", "Done"]
   *           example: "To Do"
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-25T10:04:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-25T10:04:00.000Z"
   *         teams:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/Team'
   *           example:
   *             - teamId: 1
   *               teamName: "Dev Team"
   *               members:
   *                 - userId: 1
   *                   firstName: "John"
   *                   lastName: "Doe"
   *                   email: "john.doe@example.com"
   *                   phoneNumber: "123-456-7890"
   *                   role: "Developer"
   *                   note: "Lead developer"
   *             - teamId: 2
   *               teamName: "Design Team"
   *               members:
   *                 - userId: 2
   *                   firstName: "Jane"
   *                   lastName: "Smith"
   *                   email: "jane.smith@example.com"
   *                   phoneNumber: null
   *                   role: "Designer"
   *                   note: null
   *         tasks:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/Task'
   *         clients:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/Client'
   *     Team:
   *       type: object
   *       properties:
   *         teamId:
   *           type: integer
   *           example: 1
   *         teamName:
   *           type: string
   *           example: "Dev Team"
   *         members:
   *           type: array
   *           items:
   *             type: object
   *             properties:
   *               userId:
   *                 type: integer
   *                 example: 1
   *               firstName:
   *                 type: string
   *                 example: "John"
   *               lastName:
   *                 type: string
   *                 example: "Doe"
   *               email:
   *                 type: string
   *                 example: "john.doe@example.com"
   *               phoneNumber:
   *                 type: string
   *                 example: "123-456-7890"
   *                 nullable: true
   *               role:
   *                 type: string
   *                 example: "Developer"
   *                 nullable: true
   *               note:
   *                 type: string
   *                 example: "Lead developer"
   *                 nullable: true
   *     Member:
   *       type: object
   *       properties:
   *         userId:
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
   *         phoneNumber:
   *           type: string
   *           example: "123-456-7890"
   *           nullable: true
   *         role:
   *           type: string
   *           example: "Developer"
   *           nullable: true
   *         note:
   *           type: string
   *           example: "Lead developer"
   *           nullable: true
   *     Task:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         title:
   *           type: string
   *           example: "Implement login page"
   *         description:
   *           type: string
   *           example: "Create the login page UI and backend"
   *           nullable: true
   *         status:
   *           type: string
   *           enum: ["To Do", "In Progress", "Review", "Done"]
   *           example: "To Do"
   *         dueDate:
   *           type: string
   *           format: date-time
   *           example: "2025-08-01T00:00:00.000Z"
   *           nullable: true
   *         assignee:
   *           type: object
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
   *           nullable: true
   *     Client:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         firstName:
   *           type: string
   *           example: "Jane"
   *         lastName:
   *           type: string
   *           example: "Smith"
   *         email:
   *           type: string
   *           example: "jane.smith@example.com"
   *         image:
   *           type: string
   *           example: "https://example.com/image.jpg"
   *           nullable: true
   */

  /**
   * @swagger
   * /api/projects/create:
   *   post:
   *     summary: Create a new project (Admin or Manager only)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *             properties:
   *               name:
   *                 type: string
   *                 example: "Website Redesign"
   *                 description: Name of the project
   *               description:
   *                 type: string
   *                 example: "Redesign company website for better UX"
   *                 description: Optional description of the project
   *                 nullable: true
   *               startDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-07-15"
   *                 description: Optional start date of the project (YYYY-MM-DD)
   *                 nullable: true
   *               endDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-12-31"
   *                 description: Optional end date of the project (YYYY-MM-DD)
   *                 nullable: true
   *               teamIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 example: [1, 2]
   *                 description: Optional array of team IDs to assign to the project
   *                 nullable: true
   *     responses:
   *       201:
   *         description: Project created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Project created successfully"
   *                 project:
   *                   $ref: '#/components/schemas/Project'
   *             example:
   *               message: "Project created successfully"
   *               project:
   *                 id: 1
   *                 name: "Website Redesign"
   *                 description: "Redesign company website for better UX"
   *                 startDate: "2025-07-15"
   *                 endDate: "2025-12-31"
   *                 status: "To Do"
   *                 createdAt: "2025-07-25T10:04:00.000Z"
   *                 updatedAt: "2025-07-25T10:04:00.000Z"
   *                 teams: []
   *                 tasks: []
   *                 clients: []
   *       400:
   *         description: Missing required fields or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Project name is required"
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
   *         description: Access denied - Only admins or managers can create projects
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can create projects"
   *       404:
   *         description: One or more teams not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "One or more teams not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to create project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post(
    "/create",
    authMiddleware.verifyToken,
    authMiddleware.isAdminOrManager,
    projectController.createProject
  );

  /**
   * @swagger
   * /api/projects/assign:
   *   post:
   *     summary: Assign one or more teams to a project (Admin or Manager only)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - teamIds
   *               - projectId
   *             properties:
   *               teamIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 example: [1, 2]
   *                 description: Array of team IDs to assign
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project to assign the teams to
   *     responses:
   *       200:
   *         description: Teams assigned to project successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Teams assigned to project successfully"
   *                 teams:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Team'
   *             example:
   *               message: "Teams assigned to project successfully"
   *               teams:
   *                 - teamId: 1
   *                   teamName: "Dev Team"
   *                   members:
   *                     - userId: 1
   *                       firstName: "John"
   *                       lastName: "Doe"
   *                       email: "john.doe@example.com"
   *                       phoneNumber: "123-456-7890"
   *                 - teamId: 2
   *                   teamName: "Design Team"
   *                   members:
   *                     - userId: 2
   *                       firstName: "Jane"
   *                       lastName: "Smith"
   *                       email: "jane.smith@example.com"
   *                       phoneNumber: null
   *       400:
   *         description: Missing required fields or teams already assigned
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "teamIds (array) and projectId are required"
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
   *         description: Access denied - Only admins or managers can assign teams
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can assign teams to projects"
   *       404:
   *         description: Project or one or more teams not found
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
   *                   example: "Failed to assign teams to project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post(
    "/assign",
    authMiddleware.verifyToken,
    authMiddleware.isAdminOrManager,
    projectController.assignTeamToProject
  );

  /**
   * @swagger
   * /api/projects/remove-team:
   *   post:
   *     summary: Remove one or more teams from a project (Admin or Manager only)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - teamIds
   *               - projectId
   *             properties:
   *               teamIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 example: [1, 2]
   *                 description: Array of team IDs to remove
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project to remove the teams from
   *     responses:
   *       200:
   *         description: Teams removed from project successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Teams removed from project successfully"
   *                 teams:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Team'
   *             example:
   *               message: "Teams removed from project successfully"
   *               teams:
   *                 - teamId: 1
   *                   teamName: "Dev Team"
   *                   members:
   *                     - userId: 1
   *                       firstName: "John"
   *                       lastName: "Doe"
   *                       email: "john.doe@example.com"
   *                       phoneNumber: "123-456-7890"
   *                 - teamId: 2
   *                   teamName: "Design Team"
   *                   members:
   *                     - userId: 2
   *                       firstName: "Jane"
   *                       lastName: "Smith"
   *                       email: "jane.smith@example.com"
   *                       phoneNumber: null
   *       400:
   *         description: Missing required fields or teams not assigned
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "teamIds (array) and projectId are required"
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
   *         description: Access denied - Only admins or managers can remove teams
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can remove teams from projects"
   *       404:
   *         description: Project or one or more teams not found
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
   *                   example: "Failed to remove teams from project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post(
    "/remove-team",
    authMiddleware.verifyToken,
    authMiddleware.isAdminOrManager,
    projectController.removeTeamFromProject
  );

  /**
   * @swagger
   * /api/projects/{projectId}:
   *   get:
   *     summary: Get a project by ID (All authenticated users, restricted to assigned projects for staff)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         schema:
   *           type: integer
   *         required: true
   *         description: ID of the project to retrieve
   *         example: 1
   *     responses:
   *       200:
   *         description: Project retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 project:
   *                   $ref: '#/components/schemas/Project'
   *             example:
   *               project:
   *                 id: 1
   *                 name: "Website Redesign"
   *                 description: "Redesign company website for better UX"
   *                 startDate: "2025-07-15"
   *                 endDate: "2025-12-31"
   *                 status: "To Do"
   *                 createdAt: "2025-07-25T10:04:00.000Z"
   *                 updatedAt: "2025-07-25T10:04:00.000Z"
   *                 teams:
   *                   - teamId: 1
   *                     teamName: "Dev Team"
   *                     members:
   *                       - userId: 1
   *                         firstName: "John"
   *                         lastName: "Doe"
   *                         email: "john.doe@example.com"
   *                         phoneNumber: "123-456-7890"
   *                         role: "Developer"
   *                         note: "Lead developer"
   *                   - teamId: 2
   *                     teamName: "Design Team"
   *                     members:
   *                       - userId: 2
   *                         firstName: "Jane"
   *                         lastName: "Smith"
   *                         email: "jane.smith@example.com"
   *                         phoneNumber: null
   *                         role: "Designer"
   *                         note: null
   *                 tasks:
   *                   - id: 1
   *                     title: "Implement login page"
   *                     description: "Create login page UI and backend"
   *                     status: "To Do"
   *                     dueDate: "2025-08-01T00:00:00.000Z"
   *                     assignee:
   *                       userId: 1
   *                       firstName: "John"
   *                       lastName: "Doe"
   *                       email: "john.doe@example.com"
   *                 clients:
   *                   - id: 1
   *                     firstName: "Jane"
   *                     lastName: "Smith"
   *                     email: "jane.smith@example.com"
   *                     image: "https://example.com/image.jpg"
   *       400:
   *         description: Missing required fields
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
   *         description: Access denied - User not assigned to project
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to view this project"
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
   *                   example: "Failed to fetch project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get(
    "/:projectId",
    authMiddleware.verifyToken,
    projectController.getProjectById
  );

  /**
   * @swagger
   * /api/projects/my:
   *   get:
   *     summary: Get projects for the authenticated user (All authenticated users)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *         description: Page number for pagination
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *         description: Number of projects per page
   *     responses:
   *       200:
   *         description: Projects retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 projects:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Project'
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
   *                   example: "Failed to retrieve projects"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get(
    "/my",
    authMiddleware.verifyToken,
    projectController.getMyProjects
  );

  /**
   * @swagger
   * /api/projects:
   *   get:
   *     summary: Get all projects (All authenticated users, restricted to assigned projects for staff)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: projectName
   *         schema:
   *           type: string
   *         description: Filter by project name (partial match)
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: ["To Do", "In Progress", "Review", "Done"]
   *         description: Filter by project status
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         description: Filter by project start date (YYYY-MM-DD)
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *         description: Page number for pagination
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *         description: Number of projects per page
   *     responses:
   *       200:
   *         description: Projects retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 projects:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Project'
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
   *         description: Access denied - Invalid role
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized role"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to retrieve projects"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get(
    "/",
    authMiddleware.verifyToken,
    projectController.getAllProjects
  );

  /**
   * @swagger
   * /api/projects/client/:clientId:
   *   get:
   *     summary: Get all projects for a specific client (Admin, Manager, or Client themselves)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: clientId
   *         schema:
   *           type: integer
   *         required: true
   *         description: ID of the client
   *         example: 1
   *       - in: query
   *         name: projectName
   *         schema:
   *           type: string
   *         description: Filter by project name (partial match)
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: ["To Do", "In Progress", "Review", "Done"]
   *         description: Filter by project status
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         description: Filter by project start date (YYYY-MM-DD)
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *         description: Page number for pagination
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *         description: Number of projects per page
   *     responses:
   *       200:
   *         description: Client projects retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 projects:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Project'
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
   *         description: Invalid parameters
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "clientId is required"
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
   *         description: Access denied - User not authorized to view client's projects
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to view this client's projects"
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to retrieve client projects"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get(
    "/client/:clientId",
    authMiddleware.verifyToken,
    projectController.getClientProjects
  );

  /**
   * @swagger
   * /api/projects/{projectId}/members:
   *   get:
   *     summary: Get all members of a project (All authenticated users)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         schema:
   *           type: integer
   *         required: true
   *         description: ID of the project
   *         example: 1
   *     responses:
   *       200:
   *         description: Project members retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 members:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Member'
   *             example:
   *               members:
   *                 - userId: 1
   *                   firstName: "John"
   *                   lastName: "Doe"
   *                   email: "john.doe@example.com"
   *                   phoneNumber: "123-456-7890"
   *                   role: "Developer"
   *                   note: "Lead developer"
   *                 - userId: 2
   *                   firstName: "Jane"
   *                   lastName: "Smith"
   *                   email: "jane.smith@example.com"
   *                   phoneNumber: null
   *                   role: "Designer"
   *                   note: null
   *       400:
   *         description: Missing required fields
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
   *                   example: "Failed to retrieve project members"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get(
    "/:projectId/members",
    authMiddleware.verifyToken,
    projectController.getProjectMembers
  );

  /**
   * @swagger
   * /api/projects/{projectId}/tasks:
   *   get:
   *     summary: Get all tasks for a specific project
   *     description: Retrieves all tasks associated with a given project. Staff can only view tasks for projects they are assigned to; admins can view tasks for any project.
   *     tags: [Projects]
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
   *                       example: 10
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
   *                   example: "Invalid projectId or pagination parameters"
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
   *         description: Access denied - Staff can only view tasks for projects they are assigned to
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to view tasks for this project"
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
   *                   example: "Failed to fetch project tasks"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get(
    "/:projectId/tasks",
    authMiddleware.verifyToken,
    projectController.getTasksByProject
  );

  /**
   * @swagger
   * /api/projects/{projectId}/status:
   *   put:
   *     summary: Update project status (Admin, Manager, or assigned Staff)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         schema:
   *           type: integer
   *         required: true
   *         description: ID of the project to update
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
   *                 description: New status of the project
   *     responses:
   *       200:
   *         description: Status updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Status updated successfully"
   *                 project:
   *                   $ref: '#/components/schemas/Project'
   *       400:
   *         description: Missing required fields or invalid status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Status is required"
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
   *         description: Access denied - User not assigned to project
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "You're not assigned to this project"
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
   *                   example: "Failed to update status"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put(
    "/:projectId/status",
    authMiddleware.verifyToken,
    projectController.updateProjectStatus
  );

  /**
   * @swagger
   * /api/projects/{projectId}:
   *   put:
   *     summary: Update a project (Admin or Manager only)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         schema:
   *           type: integer
   *         required: true
   *         description: ID of the project to update
   *         example: 1
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 example: "Website Redesign Updated"
   *                 description: New name of the project
   *                 nullable: true
   *               description:
   *                 type: string
   *                 example: "Updated description for better UX"
   *                 description: New description of the project
   *                 nullable: true
   *               startDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-07-20"
   *                 description: New start date of the project (YYYY-MM-DD)
   *                 nullable: true
   *               endDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-12-31"
   *                 description: New end date of the project (YYYY-MM-DD)
   *                 nullable: true
   *               status:
   *                 type: string
   *                 enum: ["To Do", "In Progress", "Review", "Done"]
   *                 example: "In Progress"
   *                 description: New status of the project
   *                 nullable: true
   *               teamIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 example: [1, 2]
   *                 description: Array of team IDs to assign to the project
   *                 nullable: true
   *     responses:
   *       200:
   *         description: Project updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Project updated successfully"
   *                 project:
   *                   $ref: '#/components/schemas/Project'
   *       400:
   *         description: Missing required fields or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "At least one field must be provided for update"
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
   *         description: Access denied - Only admins or managers can update projects
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can update projects"
   *       404:
   *         description: Project or one or more teams not found
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
   *                   example: "Failed to update project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put(
    "/:projectId",
    authMiddleware.verifyToken,
    authMiddleware.isAdminOrManager,
    projectController.updateProject
  );

  /**
   * @swagger
   * /api/projects/{projectId}:
   *   delete:
   *     summary: Delete a project (Admin or Manager only)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         schema:
   *           type: integer
   *         required: true
   *         description: ID of the project to delete
   *         example: 1
   *     responses:
   *       200:
   *         description: Project deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Project deleted successfully"
   *       400:
   *         description: Missing required fields
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
   *         description: Access denied - Only admins or managers can delete projects
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can delete projects"
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
   *                   example: "Failed to delete project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete(
    "/:projectId",
    authMiddleware.verifyToken,
    authMiddleware.isAdminOrManager,
    projectController.deleteProject
  );

  /**
   * @swagger
   * /api/projects/add-client:
   *   post:
   *     summary: Add a client to a project (Admin or Manager only)
   *     tags: [Projects]
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
   *               - clientId
   *             properties:
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project
   *               clientId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the client to add
   *     responses:
   *       200:
   *         description: Client added to project successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client added to project successfully"
   *       400:
   *         description: Missing required fields or client already associated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Project ID and Client ID are required"
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
   *         description: Access denied - Only admins or managers can add clients
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can add clients"
   *       404:
   *         description: Project or client not found
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
   *                   example: "Failed to add client to project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post(
    "/add-client",
    authMiddleware.verifyToken,
    authMiddleware.isAdminOrManager,
    projectController.addClientToProject
  );

  /**
   * @swagger
   * /api/projects/{projectId}/client/{clientId}:
   *   delete:
   *     summary: Remove a client from a project (Admin or Manager only)
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         schema:
   *           type: integer
   *         required: true
   *         description: ID of the project
   *         example: 1
   *       - in: path
   *         name: clientId
   *         schema:
   *           type: integer
   *         required: true
   *         description: ID of the client to remove
   *         example: 1
   *     responses:
   *       200:
   *         description: Client removed from project successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client removed from project successfully"
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Project ID and Client ID are required"
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
   *         description: Access denied - Only admins or managers can remove clients
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can remove clients"
   *       404:
   *         description: Project or client association not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "No association found between this client and project"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to remove client from project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete(
    "/:projectId/client/:clientId",
    authMiddleware.verifyToken,
    authMiddleware.isAdminOrManager,
    projectController.removeClientFromProject
  );

  app.use("/api/projects", router);
};
