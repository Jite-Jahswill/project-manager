const express = require("express");
const teamController = require("../controllers/team.controller");
const { verifyToken, isAdminOrManager } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Teams
   *     description: Team management endpoints
   *
   * components:
   *   schemas:
   *     Team:
   *       type: object
   *       properties:
   *         teamId:
   *           type: integer
   *           example: 1
   *         teamName:
   *           type: string
   *           example: "Dev Team"
   *         description:
   *           type: string
   *           example: "Team for handling web development projects"
   *           nullable: true
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T20:30:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T20:30:00.000Z"
   *         users:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/UserTeam'
   *         projects:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/Project'
   *     UserTeam:
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
   *         role:
   *           type: string
   *           example: "Member"
   *         note:
   *           type: string
   *           example: null
   *           nullable: true
   *         projectId:
   *           type: integer
   *           example: null
   *           nullable: true
   *     Project:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         name:
   *           type: string
   *           example: "Website Redesign"
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
   *           example: "Create login page UI and backend"
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
   * /api/teams:
   *   post:
   *     summary: Create a new team (Admin or Manager only)
   *     description: Creates a new team. Only accessible to admins or managers.
   *     tags: [Teams]
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
   *                 example: "New Development Team"
   *                 description: Name of the team
   *               description:
   *                 type: string
   *                 example: "Team for handling web development projects"
   *                 description: Optional description of the team
   *                 nullable: true
   *     responses:
   *       201:
   *         description: Team created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Team created"
   *                 team:
   *                   $ref: '#/components/schemas/Team'
   *       400:
   *         description: Missing required field 'name'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "name is required"
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
   *         description: Access denied - Only admins or managers can create teams
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can create teams"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to create team"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/", verifyToken, isAdminOrManager, teamController.createTeam);

  /**
   * @swagger
   * /api/teams:
   *   get:
   *     summary: Get all teams with pagination
   *     description: Staff can view teams they are part of. Admins and managers can view all teams. Supports pagination and search by team name.
   *     tags: [Teams]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Team name to search for (partial match)
   *         example: "Development"
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
   *         description: Number of teams per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of teams with pagination metadata
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 teams:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Team'
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
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch teams"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/", verifyToken, teamController.getAllTeams);

  /**
   * @swagger
   * /api/teams/{id}:
   *   get:
   *     summary: Get a single team by ID
   *     description: Staff can view details of a team they are part of. Admins and managers can view any team.
   *     tags: [Teams]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Team ID
   *         example: 1
   *     responses:
   *       200:
   *         description: Team details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Team'
   *       400:
   *         description: Missing required field 'id'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
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
   *       403:
   *         description: Forbidden - Staff not part of the team
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to view this team"
   *       404:
   *         description: Team not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Team not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch team"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:id", verifyToken, teamController.getTeamById);

  /**
   * @swagger
   * /api/teams/{id}:
   *   put:
   *     summary: Update a team's name, description, or user assignments (Admin or Manager only)
   *     description: Updates team details or user assignments. Only accessible to admins or managers.
   *     tags: [Teams]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Team ID
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
   *                 example: "Updated Development Team"
   *                 description: Updated team name
   *                 nullable: true
   *               description:
   *                 type: string
   *                 example: "Updated description for web development team"
   *                 description: Updated team description
   *                 nullable: true
   *               users:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                       description: User ID
   *                     role:
   *                       type: string
   *                       example: "Member"
   *                       description: User role in the team
   *                     note:
   *                       type: string
   *                       example: "New member"
   *                       description: Optional note about the user
   *                       nullable: true
   *                     projectId:
   *                       type: integer
   *                       example: null
   *                       description: Optional project ID
   *                       nullable: true
   *     responses:
   *       200:
   *         description: Team updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Team updated"
   *                 team:
   *                   $ref: '#/components/schemas/Team'
   *                 userResults:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       userId:
   *                         type: integer
   *                         example: 1
   *                       status:
   *                         type: string
   *                         example: "success"
   *                       reason:
   *                         type: string
   *                         example: "Missing userId"
   *       400:
   *         description: Missing required field 'id'
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
   *       403:
   *         description: Access denied - Only admins or managers can update teams
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can update teams"
   *       404:
   *         description: Team not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Team not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to update team"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:id", verifyToken, isAdminOrManager, teamController.updateTeam);

  /**
   * @swagger
   * /api/teams/{id}:
   *   delete:
   *     summary: Delete a team and unassign its users (Admin or Manager only)
   *     description: Deletes a team and removes all user assignments. Only accessible to admins or managers.
   *     tags: [Teams]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Team ID
   *         example: 1
   *     responses:
   *       200:
   *         description: Team deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Team deleted"
   *       400:
   *         description: Missing required field 'id'
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
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
   *       403:
   *         description: Access denied - Only admins or managers can delete teams
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can delete teams"
   *       404:
   *         description: Team not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Team not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to delete team"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:id", verifyToken, isAdminOrManager, teamController.deleteTeam);

  /**
   * @swagger
   * /api/teams/assign:
   *   post:
   *     summary: Assign users to a team (Admin or Manager only)
   *     description: Assigns users to a team with specified roles and optional notes or project IDs. Only accessible to admins or managers.
   *     tags: [Teams]
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
   *               - users
   *             properties:
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the team
   *               users:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required:
   *                     - id
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                       description: User ID
   *                     role:
   *                       type: string
   *                       example: "Member"
   *                       description: User role in the team (defaults to "Member")
   *                     note:
   *                       type: string
   *                       example: "New member"
   *                       description: Optional note about the user
   *                       nullable: true
   *                     projectId:
   *                       type: integer
   *                       example: null
   *                       description: Optional project ID
   *                       nullable: true
   *     responses:
   *       200:
   *         description: Users assigned to team successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Users assigned to team"
   *                 team:
   *                   $ref: '#/components/schemas/Team'
   *                 userCount:
   *                   type: integer
   *                   example: 2
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       userId:
   *                         type: integer
   *                         example: 1
   *                       status:
   *                         type: string
   *                         example: "success"
   *                       reason:
   *                         type: string
   *                         example: "Missing userId"
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "teamId and users array are required"
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
   *         description: Access denied - Only admins or managers can assign users
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can assign users to teams"
   *       404:
   *         description: Team or user not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Team not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to assign users to team"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/assign", verifyToken, isAdminOrManager, teamController.assignUsersToTeam);

  /**
   * @swagger
   * /api/teams/unassign:
   *   post:
   *     summary: Unassign users from a team (Admin or Manager only)
   *     description: Unassigns users from a team. Only accessible to admins or managers.
   *     tags: [Teams]
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
   *               - userIds
   *             properties:
   *               teamId:
   *                 type: integer
   *                 example: 1
   *                 description: ID of the team
   *               userIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                   example: 1
   *                 description: Array of user IDs to unassign from the team
   *     responses:
   *       200:
   *         description: Users unassigned from team successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Users unassigned from team"
   *                 team:
   *                   $ref: '#/components/schemas/Team'
   *                 userCount:
   *                   type: integer
   *                   example: 2
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       userId:
   *                         type: integer
   *                         example: 1
   *                       status:
   *                         type: string
   *                         example: "success"
   *                       reason:
   *                         type: string
   *                         example: "Not assigned"
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "teamId and userIds array are required"
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
   *         description: Access denied - Only admins or managers can unassign users
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can unassign users from teams"
   *       404:
   *         description: Team or user not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Team not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to unassign users from team"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/unassign", verifyToken, isAdminOrManager, teamController.unassignUsersFromTeam);

  app.use("/api/teams", router);
};
