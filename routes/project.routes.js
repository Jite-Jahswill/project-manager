const express = require("express");
const projectController = require("../controllers/project.controller");
const { verifyToken } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Projects
   *     description: Project management endpoints
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
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
   *           example: "Redesign company website"
   *           nullable: true
   *         startDate:
   *           type: string
   *           format: date
   *           example: "2025-08-01"
   *           nullable: true
   *         endDate:
   *           type: string
   *           format: date
   *           example: "2025-12-01"
   *           nullable: true
   *         status:
   *           type: string
   *           enum: [To Do, In Progress, Review, Done]
   *           example: "To Do"
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T20:13:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T20:13:00.000Z"
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
   *               members:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     userId:
   *                       type: integer
   *                       example: 1
   *                     firstName:
   *                       type: string
   *                       example: "John"
   *                     lastName:
   *                       type: string
   *                       example: "Doe"
   *                     email:
   *                       type: string
   *                       example: "john.doe@example.com"
   *                     phoneNumber:
   *                       type: string
   *                       example: "+1234567890"
   *                       nullable: true
   *                     role:
   *                       type: string
   *                       example: "Developer"
   *                       nullable: true
   *                     note:
   *                       type: string
   *                       example: "Lead developer"
   *                       nullable: true
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
   *                 example: "Design Homepage"
   *               description:
   *                 type: string
   *                 example: "Create wireframes for homepage"
   *                 nullable: true
   *               status:
   *                 type: string
   *                 example: "To Do"
   *               dueDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-08-15"
   *                 nullable: true
   *               assignee:
   *                 type: object
   *                 nullable: true
   *                 properties:
   *                   userId:
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
   *         clients:
   *           type: array
   *           items:
   *             type: object
   *             properties:
   *               id:
   *                 type: integer
   *                 example: 1
   *               firstName:
   *                 type: string
   *                 example: "Jane"
   *               lastName:
   *                 type: string
   *                 example: "Smith"
   *               email:
   *                 type: string
   *                 example: "jane.smith@example.com"
   *               image:
   *                 type: string
   *                 example: "https://example.com/image.jpg"
   *                 nullable: true
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
   *           example: "Create wireframes for homepage"
   *           nullable: true
   *         status:
   *           type: string
   *           example: "To Do"
   *         dueDate:
   *           type: string
   *           format: date
   *           example: "2025-08-15"
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
   * /api/projects:
   *   post:
   *     summary: Create a new project
   *     description: Creates a new project with optional team assignments. Accessible to any authenticated user.
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
   *                 example: "Redesign company website"
   *                 nullable: true
   *                 description: Description of the project
   *               startDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-08-01"
   *                 nullable: true
   *                 description: Start date of the project
   *               endDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-12-01"
   *                 nullable: true
   *                 description: End date of the project
   *               teamIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                   example: 1
   *                 description: Array of team IDs to assign to the project
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
   *       400:
   *         description: Missing required fields
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
  router.post("/", verifyToken, projectController.createProject);

  /**
   * @swagger
   * /api/projects:
   *   get:
   *     summary: Get all projects with optional filters
   *     description: Retrieves a paginated list of all projects with optional filters for projectName, status, and startDate. Accessible to any authenticated user.
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: projectName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter projects by name (partial match)
   *         example: "Website"
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [To Do, In Progress, Review, Done]
   *         required: false
   *         description: Filter projects by status
   *         example: "In Progress"
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         required: false
   *         description: Filter projects by start date
   *         example: "2025-08-01"
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
   *         description: List of projects
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
   *                   example: "Failed to retrieve projects"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/", verifyToken, projectController.getAllProjects);

  /**
   * @swagger
   * /api/projects/user/{userId}:
   *   get:
   *     summary: Get all projects for a specific user
   *     description: Retrieves a paginated list of projects associated with a specific user ID. Accessible to any authenticated user.
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID to fetch projects for
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
   *         description: List of projects for the user
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
   *         description: No projects found for this user
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "No projects found for this user"
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
  router.get("/user/:userId", verifyToken, projectController.getProjectsByUserId);

  /**
   * @swagger
   * /api/projects/{projectId}:
   *   get:
   *     summary: Get a project by ID
   *     description: Retrieves a specific project by ID, including its teams, tasks, and clients. Accessible to any authenticated user.
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
   *     responses:
   *       200:
   *         description: Project details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 project:
   *                   $ref: '#/components/schemas/Project'
   *       400:
   *         description: Missing projectId
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
   *                   example: "Failed to fetch project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:projectId", verifyToken, projectController.getProjectById);

  /**
   * @swagger
   * /api/projects/client/{clientId}:
   *   get:
   *     summary: Get all projects for a specific client
   *     description: Retrieves a paginated list of projects associated with a specific client ID, with optional filters for projectName, status, and startDate. Accessible to any authenticated user.
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: clientId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Client ID to fetch projects for
   *         example: 1
   *       - in: query
   *         name: projectName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter projects by name (partial match)
   *         example: "Website"
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [To Do, In Progress, Review, Done]
   *         required: false
   *         description: Filter projects by status
   *         example: "In Progress"
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         required: false
   *         description: Filter projects by start date
   *         example: "2025-08-01"
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
   *         description: List of projects for the client
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
   *         description: Invalid clientId, page, or limit
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
  router.get("/client/:clientId", verifyToken, projectController.getClientProjects);

  /**
   * @swagger
   * /api/projects/assign-team:
   *   post:
   *     summary: Assign a team to a project
   *     description: Assigns a team to a project and notifies team members via email. Accessible to any authenticated user.
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
   *               - teamId
   *               - projectId
   *             properties:
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the team to assign
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project
   *     responses:
   *       200:
   *         description: Team assigned successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Team assigned to project \"Website Redesign\" successfully"
   *                 teams:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       teamId:
   *                         type: integer
   *                         example: 1
   *                       teamName:
   *                         type: string
   *                         example: "Development Team"
   *                       members:
   *                         type: array
   *                         items:
   *                           type: object
   *                           properties:
   *                             userId:
   *                               type: integer
   *                               example: 1
   *                             email:
   *                               type: string
   *                               example: "john.doe@example.com"
   *                             name:
   *                               type: string
   *                               example: "John Doe"
   *                             phoneNumber:
   *                               type: string
   *                               example: "+1234567890"
   *                               nullable: true
   *       400:
   *         description: Missing required fields or team already assigned
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "teamId and projectId are required"
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
   *         description: Project or team not found
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
   *                   example: "Failed to assign team to project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/assign-team", verifyToken, projectController.assignTeamToProject);

  /**
   * @swagger
   * /api/projects/remove-team:
   *   post:
   *     summary: Remove a team from a project
   *     description: Removes a team from a project and notifies team members via email. Accessible to any authenticated user.
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
   *               - teamId
   *               - projectId
   *             properties:
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the team to remove
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project
   *     responses:
   *       200:
   *         description: Team removed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Team removed from project \"Website Redesign\" successfully"
   *                 teams:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       teamId:
   *                         type: integer
   *                         example: 1
   *                       teamName:
   *                         type: string
   *                         example: "Development Team"
   *                       members:
   *                         type: array
   *                         items:
   *                           type: object
   *                           properties:
   *                             userId:
   *                               type: integer
   *                               example: 1
   *                             email:
   *                               type: string
   *                               example: "john.doe@example.com"
   *                             name:
   *                               type: string
   *                               example: "John Doe"
   *                             phoneNumber:
   *                               type: string
   *                               example: "+1234567890"
   *                               nullable: true
   *       400:
   *         description: Missing required fields or team not assigned
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "teamId and projectId are required"
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
   *         description: Project or team not found
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
   *                   example: "Failed to remove team from project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/remove-team", verifyToken, projectController.removeTeamFromProject);

  /**
   * @swagger
   * /api/projects/{projectId}/members:
   *   get:
   *     summary: Get all members of a project
   *     description: Retrieves all members assigned to a project with their roles and notes. Accessible to any authenticated user.
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
   *     responses:
   *       200:
   *         description: List of project members
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 members:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       userId:
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
   *                       phoneNumber:
   *                         type: string
   *                         example: "+1234567890"
   *                         nullable: true
   *                       role:
   *                         type: string
   *                         example: "Developer"
   *                         nullable: true
   *                       note:
   *                         type: string
   *                         example: "Lead developer"
   *                         nullable: true
   *       400:
   *         description: Missing projectId
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
  router.get("/:projectId/members", verifyToken, projectController.getProjectMembers);

  /**
   * @swagger
   * /api/projects/{projectId}/status:
   *   put:
   *     summary: Update project status
   *     description: Updates the status of a project and notifies relevant users via email. Accessible to any authenticated user.
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
   *                 enum: [To Do, In Progress, Review, Done]
   *                 example: "Done"
   *                 description: New status for the project
   *     responses:
   *       200:
   *         description: Project status updated successfully
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
   *         description: Missing or invalid status
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
  router.put("/:projectId/status", verifyToken, projectController.updateProjectStatus);

  /**
   * @swagger
   * /api/projects/{projectId}:
   *   put:
   *     summary: Update a project
   *     description: Updates a project's details and/or team assignments, notifying affected team members via email. Accessible to any authenticated user.
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
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 example: "Website Redesign"
   *                 description: New name for the project
   *               description:
   *                 type: string
   *                 example: "Redesign company website"
   *                 nullable: true
   *                 description: New description for the project
   *               startDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-08-01"
   *                 description: New start date for the project
   *               endDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-12-01"
   *                 nullable: true
   *                 description: New end date for the project
   *               status:
   *                 type: string
   *                 enum: [To Do, In Progress, Review, Done]
   *                 example: "In Progress"
   *                 description: New status for the project
   *               teamIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                   example: 1
   *                 description: Array of team IDs to assign to the project
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
   *         description: No fields provided or invalid status
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
   *       404:
   *         description: Project or teams not found
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
  router.put("/:projectId", verifyToken, projectController.updateProject);

  /**
   * @swagger
   * /api/projects/{projectId}:
   *   delete:
   *     summary: Delete a project
   *     description: Deletes a project and notifies assigned team members and clients via email. Accessible to any authenticated user.
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
   *         description: Missing projectId
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
   *                   example: "Failed to delete project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:projectId", verifyToken, projectController.deleteProject);

  /**
   * @swagger
   * /api/projects/add-client:
   *   post:
   *     summary: Add a client to a project
   *     description: Associates a client with a project. Accessible to any authenticated user.
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
   *                 description: ID of the client
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
  router.post("/add-client", verifyToken, projectController.addClientToProject);

  /**
   * @swagger
   * /api/projects/{projectId}/client/{clientId}:
   *   delete:
   *     summary: Remove a client from a project
   *     description: Removes a client from a project. Accessible to any authenticated user.
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
   *       - in: path
   *         name: clientId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Client ID
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
   *       404:
   *         description: Project or client not found, or no association exists
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
   *                   example: "Failed to remove client from project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:projectId/client/:clientId", verifyToken, projectController.removeClientFromProject);

  /**
   * @swagger
   * /api/projects/{projectId}/tasks:
   *   get:
   *     summary: Get tasks for a specific project
   *     description: Retrieves a paginated list of tasks for a specific project. Accessible to any authenticated user.
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
   *                       example: 5
   *                     totalItems:
   *                       type: integer
   *                       example: 100
   *                     itemsPerPage:
   *                       type: integer
   *                       example: 20
   *       400:
   *         description: Missing projectId or invalid pagination
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
   *                   example: "Failed to fetch project tasks"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:projectId/tasks", verifyToken, projectController.getTasksByProject);

  app.use("/api/projects", router);
};
