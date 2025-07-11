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
   *     summary: Get all teams (Admin or Manager only)
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
   *     responses:
   *       200:
   *         description: List of teams
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
   *                   name:
   *                     type: string
   *                     example: "New Development Team"
   *                   description:
   *                     type: string
   *                     example: "Team for handling web development projects"
   *                   Users:
   *                     type: array
   *                     items:
   *                       type: object
   *                       properties:
   *                         id:
   *                           type: integer
   *                           example: 1
   *                         firstName:
   *                           type: string
   *                           example: "John"
   *                         lastName:
   *                           type: string
   *                           example: "Doe"
   *                         email:
   *                           type: string
   *                           example: "john.doe@example.com"
   *                         UserTeam:
   *                           type: object
   *                           properties:
   *                             role:
   *                               type: string
   *                               example: "Member"
   *                             note:
   *                               type: string
   *                               example: null
   *                             projectId:
   *                               type: integer
   *                               example: null
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
   *                   example: "Cannot read properties of undefined (reading 'getTableName')"
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
   *                       UserTeam:
   *                         type: object
   *                         properties:
   *                           role:
   *                             type: string
   *                             example: "Member"
   *                           note:
   *                             type: string
   *                             example: null
   *                           projectId:
   *                             type: integer
   *                             example: null
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
   *     summary: Update a team's name or description (Admin or Manager only)
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
   *             required:
   *               - name
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
   *                           UserTeam:
   *                             type: object
   *                             properties:
   *                               role:
   *                                 type: string
   *                                 example: "Member"
   *                               note:
   *                                 type: string
   *                                 example: "New member"
   *                               projectId:
   *                                 type: integer
   *                                 example: null
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
   *                     note:
   *                       type: string
   *                       example: "New member"
   *                     projectId:
   *                       type: integer
   *                       example: null
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
   *                           UserTeam:
   *                             type: object
   *                             properties:
   *                               role:
   *                                 type: string
   *                                 example: "Member"
   *                               note:
   *                                 type: string
   *                                 example: "New member"
   *                               projectId:
   *                                 type: integer
   *                                 example: null
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
   *                   example: 1
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
  router.post(
    "/assign",
    auth.verifyToken,
    auth.isAdminOrManager,
    teamController.assignUsersToTeam
  );

  app.use("/api/teams", router);
};
