const express = require("express");
const upload = require("../middlewares/upload.middleware");
const clientController = require("../controllers/client.controller");
const {
  verifyToken,
  isAdminOrManager,
} = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Clients
   *     description: Client management endpoints
   */

  /**
   * @swagger
   * /api/clients:
   *   post:
   *     summary: Create a new client (Admin or Manager only)
   *     tags: [Clients]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required:
   *               - firstName
   *               - lastName
   *               - email
   *             properties:
   *               firstName:
   *                 type: string
   *                 example: "Jane"
   *                 description: Client's first name
   *               lastName:
   *                 type: string
   *                 example: "Smith"
   *                 description: Client's last name
   *               email:
   *                 type: string
   *                 example: "jane.smith@example.com"
   *                 description: Client's email address
   *               image:
   *                 type: string
   *                 format: binary
   *                 description: Optional client profile image
   *     responses:
   *       201:
   *         description: Client created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client created successfully"
   *                 client:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     firstName:
   *                       type: string
   *                       example: "Jane"
   *                     lastName:
   *                       type: string
   *                       example: "Smith"
   *                     email:
   *                       type: string
   *                       example: "jane.smith@example.com"
   *                     image:
   *                       type: string
   *                       example: "uploads/profiles/client1.jpg"
   *                       nullable: true
   *       400:
   *         description: Missing required fields or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "firstName, lastName, and email are required"
   *       403:
   *         description: Access denied - Only admins or managers can create clients
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can create clients"
   *       409:
   *         description: Client with email already exists
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client with this email already exists"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to create client"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post(
    "/",
    verifyToken,
    isAdminOrManager,
    upload.single("image"),
    clientController.createClient
  );

  /**
   * @swagger
   * /api/clients:
   *   get:
   *     summary: Get all clients with optional search filters
   *     tags: [Clients]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: firstName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter clients by first name (partial match)
   *         example: "Jane"
   *       - in: query
   *         name: lastName
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter clients by last name (partial match)
   *         example: "Smith"
   *       - in: query
   *         name: email
   *         schema:
   *           type: string
   *         required: false
   *         description: Filter clients by email (partial match)
   *         example: "jane.smith@example.com"
   *     responses:
   *       200:
   *         description: List of clients matching the search criteria
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
   *                     example: "Jane"
   *                   lastName:
   *                     type: string
   *                     example: "Smith"
   *                   email:
   *                     type: string
   *                     example: "jane.smith@example.com"
   *                   image:
   *                     type: string
   *                     example: "uploads/profiles/client1.jpg"
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
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch clients"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/", verifyToken, clientController.getAllClients);

  /**
   * @swagger
   * /api/clients/{id}:
   *   get:
   *     summary: Get a client by ID (Admin or Manager only)
   *     tags: [Clients]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Client ID
   *         example: 1
   *     responses:
   *       200:
   *         description: Client details
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
   *                   example: "Jane"
   *                 lastName:
   *                   type: string
   *                   example: "Smith"
   *                 email:
   *                   type: string
   *                   example: "jane.smith@example.com"
   *                 image:
   *                   type: string
   *                   example: "uploads/profiles/client1.jpg"
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
   *         description: Access denied - Only admins or managers can view client details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can view client details"
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Client not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch client"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get(
    "/:id",
    verifyToken,
    isAdminOrManager,
    clientController.getClientById
  );

  /**
   * @swagger
   * /api/clients/{id}:
   *   patch:
   *     summary: Update an existing client (Admin or Manager only)
   *     tags: [Clients]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Client ID
   *         example: 1
   *     requestBody:
   *       required: false
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               firstName:
   *                 type: string
   *                 example: "Jane"
   *                 description: Client's first name
   *               lastName:
   *                 type: string
   *                 example: "Smith"
   *                 description: Client's last name
   *               email:
   *                 type: string
   *                 example: "jane.smith@example.com"
   *                 description: Client's email address
   *               image:
   *                 type: string
   *                 format: binary
   *                 description: Optional client profile image
   *     responses:
   *       200:
   *         description: Client updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client updated successfully"
   *                 client:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     firstName:
   *                       type: string
   *                       example: "Jane"
   *                     lastName:
   *                       type: string
   *                       example: "Smith"
   *                     email:
   *                       type: string
   *                       example: "jane.smith@example.com"
   *                     image:
   *                       type: string
   *                       example: "uploads/profiles/client1.jpg"
   *                       nullable: true
   *       400:
   *         description: Invalid input or client ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Invalid client ID"
   *       403:
   *         description: Access denied - Only admins or managers can update clients
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can update clients"
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Client not found"
   *       409:
   *         description: Email already exists
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client with this email already exists"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to update client"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.patch(
    "/:id",
    verifyToken,
    isAdminOrManager,
    upload.single("image"),
    clientController.updateClient
  );

  /**
   * @swagger
   * /api/clients/{id}:
   *   delete:
   *     summary: Delete a client (Admin or Manager only)
   *     tags: [Clients]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Client ID
   *         example: 1
   *     responses:
   *       200:
   *         description: Client deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client deleted successfully"
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
   *         description: Access denied - Only admins or managers can delete clients
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can delete clients"
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Client not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to delete client"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete(
    "/:id",
    verifyToken,
    isAdminOrManager,
    clientController.deleteClient
  );

  app.use("/api/clients", router);
};
