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
   *           example: "Pending"
   *           nullable: true
   *     Team:
   *       type: object
   *       properties:
   *         teamId:
   *           type: integer
   *           example: 1
   *         name:
   *           type: string
   *           example: "Dev Team"
   *         description:
   *           type: string
   *           example: "Development team"
   *           nullable: true
   *         note:
   *           type: string
   *           example: "Team assignment"
   *           nullable: true
   *         members:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/Member'
   *     Member:
   *       type: object
   *       properties:
   *         userId:
   *           type: integer
   *           example: 1
   *         name:
   *           type: string
   *           example: "John Doe"
   *         email:
   *           type: string
   *           example: "john.doe@example.com"
   *         role:
   *           type: string
   *           example: "Developer"
   *         note:
   *           type: string
   *           example: "Assigned via team"
   *           nullable: true
   *         tasks:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/Task'
   *     Task:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         title:
   *           type: string
   *           example: "Implement login page"
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
   *             id:
   *               type: integer
   *               example: 1
   *             name:
   *               type: string
   *               example: "John Doe"
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
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 description: Optional team ID to assign to the project
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
   *                 teams:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Team'
   *                 tasks:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Task'
   *             example:
   *               message: "Project created successfully"
   *               project:
   *                 id: 1
   *                 name: "Website Redesign"
   *                 description: "Redesign company website for better UX"
   *                 startDate: "2025-07-15"
   *                 endDate: "2025-12-31"
   *                 status: "Pending"
   *               teams:
   *                 - teamId: 1
   *                   name: "Dev Team"
   *                   description: "Development team"
   *                   note: "Team assignment"
   *                   members:
   *                     - userId: 1
   *                       name: "John Doe"
   *                       email: "john.doe@example.com"
   *                       role: "Developer"
   *                       note: "Assigned via team"
   *                       tasks: []
   *               tasks: []
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
   *                   example: "Only admins or managers can create projects."
   *       404:
   *         description: Team not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Team not found"
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
   *     summary: Assign an entire team to a project (Admin or Manager only)
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
   *               - role
   *             properties:
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the team to assign
   *               projectId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the project to assign the team to
   *               role:
   *                 type: string
   *                 example: "Developer"
   *                 description: Role of the team members in the project
   *               note:
   *                 type: string
   *                 example: "Primary development team"
   *                 description: Optional note about the team assignment
   *                 nullable: true
   *     responses:
   *       200:
   *         description: Team assigned to project successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Team assigned to project successfully"
   *                 team:
   *                   $ref: '#/components/schemas/Team'
   *                 project:
   *                   $ref: '#/components/schemas/Project'
   *             example:
   *               message: "Team assigned to project successfully"
   *               team:
   *                 teamId: 1
   *                 name: "Dev Team"
   *                 description: "Development team"
   *                 note: "Primary development team"
   *                 members:
   *                   - userId: 1
   *                     name: "John Doe"
   *                     email: "john.doe@example.com"
   *                     role: "Developer"
   *                     note: "Assigned via team"
   *                     tasks:
   *                       - id: 1
   *                         title: "Implement login page"
   *                         status: "To Do"
   *                         dueDate: "2025-08-01T00:00:00.000Z"
   *                         assignee:
   *                           id: 1
   *                           name: "John Doe"
   *               project:
   *                 id: 1
   *                 name: "Website Redesign"
   *                 description: "Redesign company website for better UX"
   *                 startDate: "2025-07-15"
   *                 endDate: "2025-12-31"
   *                 status: "Pending"
   *       400:
   *         description: Missing required fields, invalid input, or team already assigned to project
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
   *       403:
   *         description: Access denied - Only admins or managers can assign teams
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can assign teams to projects."
   *       404:
   *         description: Team or project not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Team not found"
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
  router.post(
    "/assign",
    authMiddleware.verifyToken,
    authMiddleware.isAdminOrManager,
    projectController.assignTeamToProject
  );

  /**
   * @swagger
   * /api/projects/{projectId}/members:
   *   get:
   *     summary: Get all members of a project with their roles and tasks
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
   *         description: List of project members with their roles and tasks
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 project:
   *                   $ref: '#/components/schemas/Project'
   *                 teams:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Team'
   *                 tasks:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Task'
   *             example:
   *               project:
   *                 id: 1
   *                 name: "Website Redesign"
   *                 description: "Redesign company website for better UX"
   *                 status: "Pending"
   *               teams:
   *                 - teamId: 1
   *                   name: "Dev Team"
   *                   description: "Development team"
   *                   note: "Team assignment"
   *                   members:
   *                     - userId: 1
   *                       name: "John Doe"
   *                       email: "john.doe@example.com"
   *                       role: "Developer"
   *                       note: "Assigned via team"
   *                       tasks:
   *                         - id: 1
   *                           title: "Implement login page"
   *                           status: "To Do"
   *                           dueDate: "2025-08-01T00:00:00.000Z"
   *                           assignee:
   *                             id: 1
   *                             name: "John Doe"
   *                     - userId: 2
   *                       name: "Jane Smith"
   *                       email: "jane.smith@example.com"
   *                       role: "Developer"
   *                       note: "Assigned via team"
   *                       tasks: []
   *               tasks:
   *                 - id: 1
   *                   title: "Implement login page"
   *                   status: "To Do"
   *                   dueDate: "2025-08-01T00:00:00.000Z"
   *                   assignee:
   *                     id: 1
   *                     name: "John Doe"
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
   * /api/projects:
   *   get:
   *     summary: Get all projects with optional search filters
   *     tags: [Projects]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: projectName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter projects by name (supports partial matches)
   *         example: "Website"
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: ["Pending", "In Progress", "Completed", "On Hold"]
   *         required: false
   *         description: Filter projects by status (exact match)
   *         example: "In Progress"
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         required: false
   *         description: Filter projects by start date (exact match)
   *         example: "2025-07-15"
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
   *         description: Number of projects per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of projects matching the search criteria
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
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       name:
   *                         type: string
   *                         example: "Website Redesign"
   *                       description:
   *                         type: string
   *                         example: "Redesign company website for better UX"
   *                         nullable: true
   *                       startDate:
   *                         type: string
   *                         format: date
   *                         example: "2025-07-15"
   *                         nullable: true
   *                       endDate:
   *                         type: string
   *                         format: date
   *                         example: "2025-12-31"
   *                         nullable: true
   *                       status:
   *                         type: string
   *                         example: "Pending"
   *                         nullable: true
   *                       client:
   *                         $ref: '#/components/schemas/Client'
   *                         nullable: true
   *                       teams:
   *                         type: array
   *                         items:
   *                           $ref: '#/components/schemas/Team'
   *                       tasks:
   *                         type: array
   *                         items:
   *                           $ref: '#/components/schemas/Task'
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
   *               projects:
   *                 - id: 1
   *                   name: "Website Redesign"
   *                   description: "Redesign company website for better UX"
   *                   startDate: "2025-07-15"
   *                   endDate: "2025-12-31"
   *                   status: "Pending"
   *                   client: null
   *                   teams:
   *                     - teamId: 1
   *                       name: "Dev Team"
   *                       description: "Development team"
   *                       note: "Team assignment"
   *                       members:
   *                         - userId: 1
   *                           name: "John Doe"
   *                           email: "john.doe@example.com"
   *                           role: "Developer"
   *                           note: "Assigned via team"
   *                           tasks:
   *                             - id: 1
   *                               title: "Implement login page"
   *                               status: "To Do"
   *                               dueDate: "2025-08-01T00:00:00.000Z"
   *                               assignee:
   *                                 id: 1
   *                                 name: "John Doe"
   *                         - userId: 2
   *                           name: "Jane Smith"
   *                           email: "jane.smith@example.com"
   *                           role: "Developer"
   *                           note: "Assigned via team"
   *                           tasks: []
   *                   tasks:
   *                     - id: 1
   *                       title: "Implement login page"
   *                       status: "To Do"
   *                       dueDate: "2025-08-01T00:00:00.000Z"
   *                       assignee:
   *                         id: 1
   *                         name: "John Doe"
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
  router.get("/", authMiddleware.verifyToken, projectController.getAllProjects);

  /**
   * @swagger
   * /api/projects/{projectId}/status:
   *   patch:
   *     summary: Update the status of a project (Assigned users only)
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
   *                 enum: ["Pending", "In Progress", "Completed", "On Hold"]
   *                 example: "In Progress"
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
   *             example:
   *               message: "Status updated successfully"
   *               project:
   *                 id: 1
   *                 name: "Website Redesign"
   *                 description: "Redesign company website for better UX"
   *                 startDate: "2025-07-15"
   *                 endDate: "2025-12-31"
   *                 status: "In Progress"
   *       400:
   *         description: Invalid status or project ID
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
  router.patch(
    "/:projectId/status",
    authMiddleware.verifyToken,
    projectController.updateProjectStatus
  );

  /**
   * @swagger
   * /api/projects/{projectId}:
   *   patch:
   *     summary: Update project details (Admin or Manager only)
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
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 example: "Website Redesign Updated"
   *                 description: Updated project name
   *               description:
   *                 type: string
   *                 example: "Updated description for better UX"
   *                 description: Updated project description
   *                 nullable: true
   *               startDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-07-15"
   *                 description: Updated start date (YYYY-MM-DD)
   *                 nullable: true
   *               endDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-12-31"
   *                 description: Updated end date (YYYY-MM-DD)
   *                 nullable: true
   *               status:
   *                 type: string
   *                 enum: ["Pending", "In Progress", "Completed", "On Hold"]
   *                 example: "In Progress"
   *                 description: Updated project status
   *                 nullable: true
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 description: Optional team ID to assign or update
   *                 nullable: true
   *               note:
   *                 type: string
   *                 example: "Assigned via team update"
   *                 description: Optional note for team assignment
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
   *                   example: "Project updated"
   *                 project:
   *                   $ref: '#/components/schemas/Project'
   *                 teams:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Team'
   *                 tasks:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Task'
   *             example:
   *               message: "Project updated"
   *               project:
   *                 id: 1
   *                 name: "Website Redesign Updated"
   *                 description: "Updated description for better UX"
   *                 startDate: "2025-07-15"
   *                 endDate: "2025-12-31"
   *                 status: "In Progress"
   *               teams:
   *                 - teamId: 1
   *                   name: "Dev Team"
   *                   description: "Development team"
   *                   note: "Assigned via team update"
   *                   members:
   *                     - userId: 1
   *                       name: "John Doe"
   *                       email: "john.doe@example.com"
   *                       role: "Developer"
   *                       note: "Assigned via team"
   *                       tasks:
   *                         - id: 1
   *                           title: "Implement login page"
   *                           status: "To Do"
   *                           dueDate: "2025-08-01T00:00:00.000Z"
   *                           assignee:
   *                             id: 1
   *                             name: "John Doe"
   *                     - userId: 2
   *                       name: "Jane Smith"
   *                       email: "jane.smith@example.com"
   *                       role: "Developer"
   *                       note: "Assigned via team"
   *                       tasks: []
   *               tasks:
   *                 - id: 1
   *                   title: "Implement login page"
   *                   status: "To Do"
   *                   dueDate: "2025-08-01T00:00:00.000Z"
   *                   assignee:
   *                     id: 1
   *                     name: "John Doe"
   *       400:
   *         description: Invalid input or project ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Invalid project ID"
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
   *                   example: "Only admins or managers can update projects."
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
   *                   example: "Failed to update project"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.patch(
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
   *                   example: "Only admins or managers can delete projects."
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
   * /api/projects/clients:
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
   *         description: Missing required fields or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Project ID and Client ID are required."
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
   *                   example: "Project not found."
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
    "/clients",
    authMiddleware.verifyToken,
    authMiddleware.isAdminOrManager,
    projectController.addClientToProject
  );

  /**
   * @swagger
   * /api/projects/{projectId}/clients/{clientId}:
   *   delete:
   *     summary: Remove a client from a project (Admin or Manager only)
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
   *         description: Project, client, or association not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "No association found between this client and project."
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
    "/:projectId/clients/:clientId",
    authMiddleware.verifyToken,
    authMiddleware.isAdminOrManager,
    projectController.removeClientFromProject
  );

  app.use("/api/projects", router);
};
