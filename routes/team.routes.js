module.exports = (app) => {
  const router = require("express").Router();
  const teamController = require("../controllers/team.controller");
  const auth = require("../middlewares/auth.middleware");

  /**
   * @swagger
   * /api/teams:
   *   post:
   *     summary: Create a new team (Admin or Manager only)
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
   *               description:
   *                 type: string
   *                 example: "Team for handling web development projects"
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     name:
   *                       type: string
   *                       example: "New Development Team"
   *                     description:
   *                       type: string
   *                       example: "Team for handling web development projects"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-18T14:37:00.000Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-18T14:37:00.000Z"
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
  router.post(
    "/",
    auth.verifyToken,
    auth.isAdminOrManager,
    teamController.createTeam
  );

  /**
   * @swagger
   * /api/teams:
   *   get:
   *     summary: Get all teams with pagination (Admin or Manager only)
   *     tags: [Teams]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Team name to search for
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
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       name:
   *                         type: string
   *                         example: "New Development Team"
   *                       description:
   *                         type: string
   *                         example: "Team for handling web development projects"
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *                         example: "2025-07-18T14:37:00.000Z"
   *                       updatedAt:
   *                         type: string
   *                         format: date-time
   *                         example: "2025-07-18T14:37:00.000Z"
   *                       Users:
   *                         type: array
   *                         items:
   *                           type: object
   *                           properties:
   *                             id:
   *                               type: integer
   *                               example: 1
   *                             firstName:
   *                               type: string
   *                               example: "John"
   *                             lastName:
   *                               type: string
   *                               example: "Doe"
   *                             email:
   *                               type: string
   *                               example: "john.doe@example.com"
   *                             role:
   *                               type: string
   *                               example: "Member"
   *                             note:
   *                               type: string
   *                               example: null
   *                             projectId:
   *                               type: integer
   *                               example: null
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
   *       403:
   *         description: Access denied - Only admins or managers can view teams
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers are allowed"
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
  router.get(
    "/",
    auth.verifyToken,
    auth.isAdminOrManager,
    teamController.getAllTeams
  );

  /**
   * @swagger
   * /api/teams/{id}:
   *   get:
   *     summary: Get a single team by ID
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
   *               type: object
   *               properties:
   *                 id:
   *                   type: integer
   *                   example: 1
   *                 name:
   *                   type: string
   *                   example: "New Development Team"
   *                 description:
   *                   type: string
   *                   example: "Team for handling web development projects"
   *                 createdAt:
   *                   type: string
   *                   format: date-time
   *                   example: "2025-07-18T14:37:00.000Z"
   *                 updatedAt:
   *                   type: string
   *                   format: date-time
   *                   example: "2025-07-18T14:37:00.000Z"
   *                 Users:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
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
   *                       role:
   *                         type: string
   *                         example: "Member"
   *                       note:
   *                         type: string
   *                         example: null
   *                       projectId:
   *                         type: integer
   *                         example: null
   *                 Projects:
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
  router.get("/:id", auth.verifyToken, teamController.getTeamById);

  /**
   * @swagger
   * /api/teams/{id}:
   *   put:
   *     summary: Update a team's name, description, or user assignments (Admin or Manager only)
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
   *               description:
   *                 type: string
   *                 example: "Updated description for web development team"
   *               users:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     role:
   *                       type: string
   *                       example: "Member"
   *                     note:
   *                       type: string
   *                       example: "New member"
   *                     projectId:
   *                       type: integer
   *                       example: null
   *                       description: Optional project ID (not validated, can be updated later)
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     name:
   *                       type: string
   *                       example: "Updated Development Team"
   *                     description:
   *                       type: string
   *                       example: "Updated description for web development team"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-18T14:37:00.000Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-18T14:37:00.000Z"
   *                     Users:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           firstName:
   *                             type: string
   *                             example: "John"
   *                           lastName:
   *                             type: string
   *                             example: "Doe"
   *                           email:
   *                             type: string
   *                             example: "john.doe@example.com"
   *                           role:
   *                             type: string
   *                             example: "Member"
   *                           note:
   *                             type: string
   *                             example: "New member"
   *                           projectId:
   *                             type: integer
   *                             example: null
   *                     Projects:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           name:
   *                             type: string
   *                             example: "Website Redesign"
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
  router.put(
    "/:id",
    auth.verifyToken,
    auth.isAdminOrManager,
    teamController.updateTeam
  );

  /**
   * @swagger
   * /api/teams/{id}:
   *   delete:
   *     summary: Delete a team and unassign its users (Admin or Manager only)
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
  router.delete(
    "/:id",
    auth.verifyToken,
    auth.isAdminOrManager,
    teamController.deleteTeam
  );

  /**
   * @swagger
   * /api/teams/assign:
   *   post:
   *     summary: Assign users to a team (Admin or Manager only)
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
   *                     role:
   *                       type: string
   *                       example: "Member"
   *                       description: User role in the team (defaults to "Member")
   *                     note:
   *                       type: string
   *                       example: "New member"
   *                       description: Optional note about the user
   *                     projectId:
   *                       type: integer
   *                       example: null
   *                       description: Optional project ID (not validated, can be updated later)
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     name:
   *                       type: string
   *                       example: "New Development Team"
   *                     description:
   *                       type: string
   *                       example: "Team for handling web development projects"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-18T14:37:00.000Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-18T14:37:00.000Z"
   *                     Users:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           firstName:
   *                             type: string
   *                             example: "John"
   *                           lastName:
   *                             type: string
   *                             example: "Doe"
   *                           email:
   *                             type: string
   *                             example: "john.doe@example.com"
   *                           role:
   *                             type: string
   *                             example: "Member"
   *                           note:
   *                             type: string
   *                             example: "New member"
   *                           projectId:
   *                             type: integer
   *                             example: null
   *                     Projects:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           name:
   *                             type: string
   *                             example: "Website Redesign"
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
   *     400:
   *       description: Missing required fields
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               message:
   *                 type: string
   *                 example: "teamId and users array are required"
   *     403:
   *       description: Access denied - Only admins or managers can assign users
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               message:
   *                 type: string
   *                 example: "Only admins or managers can assign users to teams"
   *     404:
   *       description: Team or user not found
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               error:
   *                 type: string
   *                 example: "Team not found"
   *     500:
   *       description: Internal server error
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               error:
   *                 type: string
   *                 example: "Failed to assign users to team"
   *               details:
   *                 type: string
   *                 example: "Database error"
   */
  router.post(
    "/assign",
    auth.verifyToken,
    auth.isAdminOrManager,
    teamController.assignUsersToTeam
  );

  /**
   * @swagger
   * /api/teams/unassign:
   *   post:
   *     summary: Unassign users from a team (Admin or Manager only)
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     name:
   *                       type: string
   *                       example: "New Development Team"
   *                     description:
   *                       type: string
   *                       example: "Team for handling web development projects"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-18T14:37:00.000Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-18T14:37:00.000Z"
   *                     Users:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           firstName:
   *                             type: string
   *                             example: "John"
   *                           lastName:
   *                             type: string
   *                             example: "Doe"
   *                           email:
   *                             type: string
   *                             example: "john.doe@example.com"
   *                           role:
   *                             type: string
   *                             example: "Member"
   *                           note:
   *                             type: string
   *                             example: null
   *                           projectId:
   *                             type: integer
   *                             example: null
   *                     Projects:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           id:
   *                             type: integer
   *                             example: 1
   *                           name:
   *                             type: string
   *                             example: "Website Redesign"
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
   *     400:
   *       description: Missing required fields
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               message:
   *                 type: string
   *                 example: "teamId and userIds array are required"
   *     403:
   *       description: Access denied - Only admins or managers can unassign users
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               message:
   *                 type: string
   *                 example: "Only admins or managers can unassign users from teams"
   *     404:
   *       description: Team or user not found
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               error:
   *                 type: string
   *                 example: "Team not found"
   *     500:
   *       description: Internal server error
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               error:
   *                 type: string
   *                 example: "Failed to unassign users from team"
   *               details:
   *                 type: string
   *                 example: "Database error"
   */
  router.post(
    "/unassign",
    auth.verifyToken,
    auth.isAdminOrManager,
    teamController.unassignUsersFromTeam
  );

  app.use("/api/teams", router);
};
