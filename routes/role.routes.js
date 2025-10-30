// routes/role.routes.js
const express = require("express");
const roleController = require("../controllers/role.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * components:
   *   schemas:
   *     Role:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         name:
   *           type: string
   *           example: "Project Manager"
   *         permissions:
   *           type: array
   *           items:
   *             type: string
   *           example: ["project:create", "document:read"]
   *         permissionsDetail:
   *           type: array
   *           items:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               description:
   *                 type: string
   *                 nullable: true
   *         createdAt:
   *           type: string
   *           format: date-time
   *         updatedAt:
   *           type: string
   *           format: date-time
   *       required:
   *         - id
   *         - name
   *         - permissions
   *
   *     Permission:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *         name:
   *           type: string
   *           example: "document:create"
   *         description:
   *           type: string
   *           nullable: true
   *       required:
   *         - id
   *         - name
   */

  /**
   * @swagger
   * /api/roles:
   *   post:
   *     summary: Create a new role
   *     tags: [Role]
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
   *                 example: "Editor"
   *               permissionNames:
   *                 type: array
   *                 items:
   *                   type: string
   *                 example: ["document:read", "document:update"]
   *                 description: Array of valid permission names
   *     responses:
   *       201:
   *         description: Role created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 role:
   *                   $ref: '#/components/schemas/Role'
   *       400:
   *         description: Invalid input (missing name, invalid permissions)
   *       409:
   *         description: Role name already exists
   *       401:
   *         description: Unauthorized
   */
  router.post("/", verifyToken, hasPermission("role:create"), roleController.createRole);

  /**
   * @swagger
   * /api/roles:
   *   get:
   *     summary: Get all roles with permission details
   *     tags: [Role]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of roles
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 roles:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Role'
   *       401:
   *         description: Unauthorized
   */
  router.get("/", verifyToken, hasPermission("role:read"), roleController.getAllRoles);

  /**
   * @swagger
   * /api/roles/{id}:
   *   get:
   *     summary: Get a single role by ID
   *     tags: [Role]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Role ID
   *     responses:
   *       200:
   *         description: Role details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 role:
   *                   $ref: '#/components/schemas/Role'
   *       404:
   *         description: Role not found
   *       401:
   *         description: Unauthorized
   */
  router.get("/:id", verifyToken, hasPermission("role:read"), roleController.getRoleById);

  /**
   * @swagger
   * /api/roles/{id}:
   *   put:
   *     summary: Update a role (name and/or permissions)
   *     tags: [Role]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 example: "Senior Editor"
   *               permissionNames:
   *                 type: array
   *                 items:
   *                   type: string
   *                 example: ["document:read", "document:update", "document:delete"]
   *     responses:
   *       200:
   *         description: Role updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 role:
   *                   $ref: '#/components/schemas/Role'
   *       400:
   *         description: Invalid input
   *       404:
   *         description: Role not found
   *       409:
   *         description: Role name already taken
   *       401:
   *         description: Unauthorized
   */
  router.put("/:id", verifyToken, hasPermission("role:update"), roleController.updateRole);

  /**
   * @swagger
   * /api/roles/{id}:
   *   delete:
   *     summary: Delete a role (only if not assigned to users)
   *     tags: [Role]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Role deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Role deleted successfully"
   *       400:
   *         description: Role is assigned to users
   *       404:
   *         description: Role not found
   *       401:
   *         description: Unauthorized
   */
  router.delete("/:id", verifyToken, hasPermission("role:delete"), roleController.deleteRole);

  /**
   * @swagger
   * /api/roles/permissions:
   *   get:
   *     summary: Get all available permissions (for UI checkbox)
   *     tags: [Role]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of permissions
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 permissions:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Permission'
   *       401:
   *         description: Unauthorized
   */
  router.get("/permissions", roleController.getAllPermissions);

  // Mount router
  app.use("/api/roles", router);
};
