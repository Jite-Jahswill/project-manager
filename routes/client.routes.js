const express = require("express");
const upload = require("../middlewares/upload.middleware");
const clientController = require("../controllers/client.controller");
const { verifyToken, isAdminOrManager } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Clients
   *     description: Client management endpoints
   *
   * components:
   *   schemas:
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
   *         phoneNumber:
   *           type: string
   *           example: "+1234567890"
   *           nullable: true
   *         image:
   *           type: string
   *           example: "uploads/profiles/client1.jpg"
   *           nullable: true
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T23:05:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T23:05:00.000Z"
   *     Error:
   *       type: object
   *       properties:
   *         message:
   *           type: string
   *           example: "Failed to fetch clients"
   *         details:
   *           type: string
   *           example: "Database error"
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
   *           example: "2025-07-01"
   *           nullable: true
   *         endDate:
   *           type: string
   *           format: date
   *           example: "2025-12-31"
   *           nullable: true
   *         status:
   *           type: string
   *           example: "In Progress"
   *         team:
   *           type: object
   *           nullable: true
   *           properties:
   *             teamId:
   *               type: integer
   *               example: 1
   *             teamName:
   *               type: string
   *               example: "Development Team"
   *             members:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   userId:
   *                     type: integer
   *                     example: 2
   *                   firstName:
   *                     type: string
   *                     example: "John"
   *                   lastName:
   *                     type: string
   *                     example: "Doe"
   *                   email:
   *                     type: string
   *                     example: "john.doe@example.com"
   *                   phoneNumber:
   *                     type: string
   *                     example: "+1234567890"
   *                     nullable: true
   *                   role:
   *                     type: string
   *                     example: "Developer"
   *                   note:
   *                     type: string
   *                     example: "Lead developer"
   *                     nullable: true
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
   *                 example: "Implement login feature"
   *               description:
   *                 type: string
   *                 example: "Create login functionality"
   *                 nullable: true
   *               status:
   *                 type: string
   *                 example: "In Progress"
   *               dueDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-07-19"
   *                 nullable: true
   *               assignee:
   *                 type: object
   *                 nullable: true
   *                 properties:
   *                   userId:
   *                     type: integer
   *                     example: 2
   *                   firstName:
   *                     type: string
   *                     example: "John"
   *                   lastName:
   *                     type: string
   *                     example: "Doe"
   *                   email:
   *                     type: string
   *                     example: "john.doe@example.com"
   */

  /**
   * @swagger
   * /api/clients/me:
   *   get:
   *     summary: Get current client's details
   *     description: Retrieves the details of the authenticated client.
   *     tags: [Clients]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Current client details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 client:
   *                   $ref: '#/components/schemas/Client'
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get("/me", verifyToken, clientController.getCurrentClient);

  /**
   * @swagger
   * /api/clients:
   *   get:
   *     summary: Get all clients (Admin only)
   *     description: Retrieves a list of all clients with optional filters for firstName, lastName, or email. Only accessible to admins.
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
   *         description: Number of clients per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of all clients
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 clients:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Client'
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
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Access denied - Only admins can view all clients
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get("/", verifyToken, clientController.getAllClients);

  /**
   * @swagger
   * /api/clients/{id}:
   *   get:
   *     summary: Get a client by ID
   *     description: Retrieves a client's details. Clients can view their own details; admins and managers can view any client's details.
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
   *                 client:
   *                   $ref: '#/components/schemas/Client'
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Access denied - Unauthorized to view this client
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get("/:id", verifyToken, isAdminOrManager, clientController.getClientById);

  /**
   * @swagger
   * /api/clients:
   *   post:
   *     summary: Create a new client (Admin only)
   *     description: Creates a new client with an auto-generated password and sends an OTP for email verification. Only accessible to admins.
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
   *               phoneNumber:
   *                 type: string
   *                 example: "+1234567890"
   *                 description: Client's phone number
   *                 nullable: true
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
   *                   $ref: '#/components/schemas/Client'
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Access denied - Only admins can create clients
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       409:
   *         description: Client with email already exists
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post("/", verifyToken, upload.single("image"), clientController.createClient);

  /**
   * @swagger
   * /api/clients/{id}:
   *   put:
   *     summary: Update an existing client
   *     description: Updates a client's details. Clients can update their own details; admins and managers can update any client's details.
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
   *               phoneNumber:
   *                 type: string
   *                 example: "+1234567890"
   *                 description: Client's phone number
   *                 nullable: true
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
   *                   $ref: '#/components/schemas/Client'
   *       400:
   *         description: Invalid input or client ID
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Access denied - Unauthorized to update this client
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       409:
   *         description: Email already in use
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.put("/:id", verifyToken, upload.single("image"), clientController.updateClient);

  /**
   * @swagger
   * /api/clients/{id}:
   *   delete:
   *     summary: Delete a client (Admin only)
   *     description: Deletes a client and their associated profile image. Only accessible to admins.
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
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Access denied - Only admins can delete clients
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.delete("/:id", verifyToken, clientController.deleteClient);

  /**
   * @swagger
   * /api/clients/{clientId}/projects:
   *   get:
   *     summary: Get all projects owned by a client
   *     description: Retrieves all projects associated with a client. Clients can view their own projects; admins can view any client's projects.
   *     tags: [Clients]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: clientId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Client ID
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
   *         description: Number of projects per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of projects owned by the client
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
   *                       example: 1
   *                     totalItems:
   *                       type: integer
   *                       example: 10
   *                     itemsPerPage:
   *                       type: integer
   *                       example: 20
   *       400:
   *         description: Invalid client ID or pagination parameters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Access denied - Unauthorized to view this client's projects
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.get("/:clientId/projects", verifyToken, clientController.getClientProjects);

  /**
   * @swagger
   * /api/clients/login:
   *   post:
   *     summary: Client login
   *     description: Authenticates a client and returns a JWT token. Email must be verified.
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
   *                   $ref: '#/components/schemas/Client'
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       401:
   *         description: Invalid credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       403:
   *         description: Email not verified
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post("/login", clientController.loginClient);

  /**
   * @swagger
   * /api/clients/verify:
   *   post:
   *     summary: Verify client email with OTP
   *     description: Verifies a client's email using the OTP sent during account creation or resend.
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
   *         description: Missing required fields, invalid OTP, or email already verified
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post("/verify", clientController.verifyClient);

  /**
   * @swagger
   * /api/clients/forgot-password:
   *   post:
   *     summary: Request password reset OTP
   *     description: Sends an OTP to the client's email for password reset.
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
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post("/forgot-password", clientController.forgotPassword);

  /**
   * @swagger
   * /api/clients/reset-password:
   *   post:
   *     summary: Reset password using OTP
   *     description: Resets a client's password using the OTP sent via email.
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
   *         description: Missing required fields, invalid OTP, or OTP expired
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post("/reset-password", clientController.resetPassword);

  /**
   * @swagger
   * /api/clients/resend-verification-otp:
   *   post:
   *     summary: Resend verification OTP for unverified client
   *     description: Resends an OTP to a client's email for email verification.
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
   *         description: Verification OTP resent successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Verification OTP resent to email"
   *       400:
   *         description: Missing email or email already verified
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       404:
   *         description: Client not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post("/resend-verification-otp", clientController.resendVerificationOTP);

  app.use("/api/clients", router);
};
