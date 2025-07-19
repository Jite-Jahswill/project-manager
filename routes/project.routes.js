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
   *         teamId:
   *           type: integer
   *           example: 1
   *           nullable: true
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
   *               email:
   *                 type: string
   *                 example: "john.doe@example.com"
   *               name:
   *                 type: string
   *                 example: "John Doe"
   *               phoneNumber:
   *                 type: string
   *                 example: "123-456-7890"
   *                 nullable: true
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
   *             id:
   *               type: integer
   *               example: 1
   *             name:
   *               type: string
   *               example: "John Doe"
   *             email:
   *               type: string
   *               example: "john.doe@example.com"
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
   *             example:
   *               message: "Project created successfully"
   *               project:
   *                 id: 1
   *                 name: "Website Redesign"
   *                 description: "Redesign company website for better UX"
   *                 startDate: "2025-07-15"
   *                 endDate: "2025-12-31"
   *                 status: "To Do"
   *                 teamId: 1
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
   *     summary: Assign a team to a project (Admin or Manager only)
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
   *                 description: ID of the project to assign the team to
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
   *                   example: "Team \"Dev Team\" assigned to project successfully."
   *                 team:
   *                   $ref: '#/components/schemas/Team'
   *             example:
   *               message: "Team \"Dev Team\" assigned to project successfully."
   *               team:
   *                 teamId: 1
   *                 teamName: "Dev Team"
   *                 members:
   *                   - userId: 1
   *                     email: "john.doe@example.com"
   *                     name: "John Doe"
   *                     phoneNumber: "123-456-7890"
   *                   - userId: 2
   *                     email: "jane.smith@example.com"
   *                     name: "Jane Smith"
   *                     phoneNumber: null
   *       400:
   *         description: Missing required fields or invalid input
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
   * /api/projects/remove-team:
   *   post:
   *     summary: Remove a team from a project (Admin or Manager only)
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
   *                 description: ID of the project to remove the team from
   *     responses:
   *       200:
   *         description: Team removed from project successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Team \"Dev Team\" removed from project successfully."
   *                 team:
   *                   $ref: '#/components/schemas/Team'
   *             example:
   *               message: "Team \"Dev Team\" removed from project successfully."
   *               team:
   *                 teamId: 1
   *                 teamName: "Dev Team"
   *                 members:
   *                   - userId: 1
   *                     email: "john.doe@example.com"
   *                     name: "John Doe"
   *                     phoneNumber: "123-456-7890"
   *                   - userId: 2
   *                     email: "jane.smith@example.com"
   *                     name: "Jane Smith"
   *                     phoneNumber: null
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
   *       403:
   *         description: Access denied - Only admins or managers can remove teams
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can remove teams from projects."
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
   *                   example: "Failed to remove team from project"
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
   * /api/projects/{projectId}/members:
   *   get:
   *     summary: Get all members of a project with their tasks
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
   *         description: List of project members with their tasks
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
   *                         example: "123-456-7890"
   *                         nullable: true
   *                       role:
   *                         type: string
   *                         example: "Developer"
   *             example:
   *               members:
   *                 - userId: 1
   *                   firstName: "John"
   *                   lastName: "Doe"
   *                   email: "john.doe@example.com"
   *                   phoneNumber: "123-456-7890"
   *                   role: "Developer"
   *                 - userId: 2
   *                   firstName: "Jane"
   *                   lastName: "Smith"
   *                   email: "jane.smith@example.com"
   *                   phoneNumber: null
   *                   role: "Designer"
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
   *           enum: ["To Do", "In Progress", "Review", "Done"]
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
  router.get("/", authMiddleware.verifyToken, projectController.getAllProjects);

  /**
   * @swagger
   * /api/projects/{projectId}/status:
   *   patch:
   *     summary: Update the status of a project (Assigned team members only)
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
   *                 enum: ["To Do", "In Progress", "Review", "Done"]
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
   *                 teamId: 1
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
   *                 enum: ["To Do", "In Progress", "Review", "Done"]
   *                 example: "In Progress"
   *                 description: Updated project status
   *                 nullable: true
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 description: Optional team ID to assign or update
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
   *             example:
   *               message: "Project updated"
   *               project:
   *                 id: 1
   *                 name: "Website Redesign Updated"
   *                 description: "Updated description for better UX"
   *                 startDate: "2025-07-15"
   *                 endDate: "2025-12-31"
   *                 status: "In Progress"
   *                 teamId: 1
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
