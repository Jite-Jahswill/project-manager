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
   *                   example: "Client created successfully, OTP and password sent to email"
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
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "firstName, lastName, and email are required"
   *       403:
   *         description: Access denied
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
   *                 message:
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
   * /api/clients/login:
   *   post:
   *     summary: Client login
   *     tags: [Clients]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *             properties:
   *               email:
   *                 type: string
   *                 example: "jane.smith@example.com"
   *                 description: Client's email address
   *               password:
   *                 type: string
   *                 example: "generatedPassword123"
   *                 description: Client's password
   *     responses:
   *       200:
   *         description: Client logged in successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client logged in successfully"
   *                 token:
   *                   type: string
   *                   example: "jwt.token.here"
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
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "email and password are required"
   *       401:
   *         description: Invalid credentials
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Invalid email or password"
   *       403:
   *         description: Email not verified
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Email not verified"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to login client"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/login", clientController.loginClient);

  /**
   * @swagger
   * /api/clients/verify:
   *   post:
   *     summary: Verify client email with OTP
   *     tags: [Clients]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - otp
   *             properties:
   *               email:
   *                 type: string
   *                 example: "jane.smith@example.com"
   *                 description: Client's email address
   *               otp:
   *                 type: string
   *                 example: "123456"
   *                 description: OTP sent to client's email
   *     responses:
   *       200:
   *         description: Email verified successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Email verified successfully"
   *       400:
   *         description: Missing required fields or invalid OTP
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Invalid OTP"
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
   *                   example: "Failed to verify email"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/verify", clientController.verifyClient);

  /**
   * @swagger
   * /api/clients/forgot-password:
   *   post:
   *     summary: Request password reset OTP
   *     tags: [Clients]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *             properties:
   *               email:
   *                 type: string
   *                 example: "jane.smith@example.com"
   *                 description: Client's email address
   *     responses:
   *       200:
   *         description: Password reset OTP sent
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Password reset OTP sent to email"
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "email is required"
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
   *                   example: "Failed to process password reset"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/forgot-password", clientController.forgotPassword);

  /**
   * @swagger
   * /api/clients/reset-password:
   *   post:
   *     summary: Reset password using OTP
   *     tags: [Clients]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - otp
   *               - newPassword
   *             properties:
   *               email:
   *                 type: string
   *                 example: "jane.smith@example.com"
   *                 description: Client's email address
   *               otp:
   *                 type: string
   *                 example: "123456"
   *                 description: OTP sent to client's email
   *               newPassword:
   *                 type: string
   *                 example: "newSecurePassword123"
   *                 description: New password for the client
   *     responses:
   *       200:
   *         description: Password reset successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Password reset successfully"
   *       400:
   *         description: Missing required fields or invalid OTP
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Invalid OTP"
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
   *                   example: "Failed to reset password"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/reset-password", clientController.resetPassword);

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
   *               type: object
   *               properties:
   *                 clients:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       firstName:
   *                         type: string
   *                         example: "Jane"
   *                       lastName:
   *                         type: string
   *                         example: "Smith"
   *                       email:
   *                         type: string
   *                         example: "jane.smith@example.com"
   *                       image:
   *                         type: string
   *                         example: "uploads/profiles/client1.jpg"
   *                         nullable: true
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
   *         description: Access denied
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
   *                   example: "Client updated"
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
   *                 error:
   *                   type: string
   *                   example: "Invalid client ID"
   *       403:
   *         description: Access denied
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
   *         description: Email already in use
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Email already in use"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Error updating client"
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
   *                   example: "Client deleted"
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
   *         description: Access denied
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
   *                   example: "Error deleting client"
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
