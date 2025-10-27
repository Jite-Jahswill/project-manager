const express = require("express");
const { upload, uploadToFirebase } = require("../middlewares/upload.middleware");
const clientController = require("../controllers/client.controller");
const verifyToken = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Clients
   *     description: Client management endpoints
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *   schemas:
   *     Client:
   *       type: object
   *       properties:
   *         id:
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
   *         phoneNumber:
   *           type: string
   *           example: "+1234567890"
   *         image:
   *           type: string
   *           example: "https://storage.googleapis.com/my-flxi-shop.appspot.com/Uploads/files-1234567890.jpg"
   *         cacCertificate:
   *           type: string
   *           example: "https://storage.googleapis.com/my-flxi-shop.appspot.com/Uploads/cac-1234567890.pdf"
   *         tin:
   *           type: string
   *           example: "https://storage.googleapis.com/my-flxi-shop.appspot.com/Uploads/tin-1234567890.pdf"
   *         taxClearance:
   *           type: string
   *           example: "https://storage.googleapis.com/my-flxi-shop.appspot.com/Uploads/tax-1234567890.pdf"
   *         corporateProfile:
   *           type: string
   *           example: "https://storage.googleapis.com/my-flxi-shop.appspot.com/Uploads/profile-1234567890.pdf"
   *         address:
   *           type: string
   *           example: "123 Main St"
   *         city:
   *           type: string
   *           example: "Lagos"
   *         state:
   *           type: string
   *           example: "Lagos"
   *         country:
   *           type: string
   *           example: "Nigeria"
   *         bankName:
   *           type: string
   *           example: "First Bank"
   *         accountNumber:
   *           type: string
   *           example: "1234567890"
   *         accountName:
   *           type: string
   *           example: "John Doe Enterprises"
   *         approvalStatus:
   *           type: string
   *           enum: [pending, approved, rejected]
   *           example: "pending"
   */

  /**
   * @swagger
   * /api/clients/{clientId}/projects:
   *   get:
   *     summary: Get projects owned by a client
   *     description: Retrieves a paginated list of projects for a client, including team and task details. Requires approved registration status.
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
   *         description: Projects retrieved successfully
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
   *                         example: "Project Alpha"
   *                       description:
   *                         type: string
   *                         example: "A sample project"
   *                       startDate:
   *                         type: string
   *                         format: date
   *                         example: "2025-10-01"
   *                       endDate:
   *                         type: string
   *                         format: date
   *                         example: "2025-12-31"
   *                       status:
   *                         type: string
   *                         example: "active"
   *                       team:
   *                         type: object
   *                         properties:
   *                           teamId:
   *                             type: integer
   *                             example: 1
   *                           teamName:
   *                             type: string
   *                             example: "Development Team"
   *                           members:
   *                             type: array
   *                             items:
   *                               type: object
   *                               properties:
   *                                 userId:
   *                                   type: integer
   *                                   example: 1
   *                                 firstName:
   *                                   type: string
   *                                   example: "Jane"
   *                                 lastName:
   *                                   type: string
   *                                   example: "Smith"
   *                                 email:
   *                                   type: string
   *                                   example: "jane.smith@example.com"
   *                                 phoneNumber:
   *                                   type: string
   *                                   example: "+1234567890"
   *                                 role:
   *                                   type: string
   *                                   example: "developer"
   *                                 note:
   *                                   type: string
   *                                   example: "Lead developer"
   *                       tasks:
   *                         type: array
   *                         items:
   *                           type: object
   *                           properties:
   *                             id:
   *                               type: integer
   *                               example: 1
   *                             title:
   *                               type: string
   *                               example: "Task 1"
   *                             description:
   *                               type: string
   *                               example: "Implement feature"
   *                             status:
   *                               type: string
   *                               example: "pending"
   *                             dueDate:
   *                               type: string
   *                               format: date
   *                               example: "2025-10-15"
   *                             assignee:
   *                               type: object
   *                               properties:
   *                                 userId:
   *                                   type: integer
   *                                   example: 1
   *                                 firstName:
   *                                   type: string
   *                                   example: "Jane"
   *                                 lastName:
   *                                   type: string
   *                                   example: "Smith"
   *                                 email:
   *                                   type: string
   *                                   example: "jane.smith@example.com"
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
   *         description: Missing clientId
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
   *       403:
   *         description: Client registration not approved
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client registration not approved"
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
   *                   example: "Failed to fetch client projects"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:clientId/projects", verifyToken, clientController.getClientProjects);

  /**
   * @swagger
   * /api/clients:
   *   post:
   *     summary: Create a new client
   *     description: Creates a new client with company information, contact, and banking details. Requires file uploads for CAC Certificate, TIN, Tax Clearance, and Corporate Profile.
   *     tags: [Clients]
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
   *               - files
   *             properties:
   *               firstName:
   *                 type: string
   *                 example: "John"
   *               lastName:
   *                 type: string
   *                 example: "Doe"
   *               email:
   *                 type: string
   *                 example: "john.doe@example.com"
   *               phoneNumber:
   *                 type: string
   *                 example: "+1234567890"
   *               address:
   *                 type: string
   *                 example: "123 Main St"
   *               city:
   *                 type: string
   *                 example: "Lagos"
   *               state:
   *                 type: string
   *                 example: "Lagos"
   *               country:
   *                 type: string
   *                 example: "Nigeria"
   *               bankName:
   *                 type: string
   *                 example: "First Bank"
   *               accountNumber:
   *                 type: string
   *                 example: "1234567890"
   *               accountName:
   *                 type: string
   *                 example: "John Doe Enterprises"
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Files for CAC Certificate, TIN, Tax Clearance, Corporate Profile, and optional profile image (JPEG, PNG, WebP, PDF, max 10MB each)
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
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "firstName, lastName, email, cacCertificate, tin, taxClearance, and corporateProfile are required"
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
   *                 message:
   *                   type: string
   *                   example: "Failed to create client"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/", upload, uploadToFirebase, clientController.createClient);

  /**
   * @swagger
   * /api/clients/{id}/company-info:
   *   put:
   *     summary: Upload company information
   *     description: Updates company information (CAC Certificate, TIN, Tax Clearance, Corporate Profile) for a client.
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
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required:
   *               - files
   *             properties:
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Files for CAC Certificate, TIN, Tax Clearance, Corporate Profile (PDF, max 10MB each)
   *     responses:
   *       200:
   *         description: Company information updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Company information updated successfully"
   *                 client:
   *                   $ref: '#/components/schemas/Client'
   *       400:
   *         description: Missing required files
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "CAC Certificate, TIN, Tax Clearance, and Corporate Profile are required"
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
   *                   example: "Failed to upload company information"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:id/company-info", verifyToken, upload, uploadToFirebase, clientController.uploadCompanyInfo);

  /**
   * @swagger
   * /api/clients/{id}/registration:
   *   put:
   *     summary: Update registration details
   *     description: Updates contact and banking details for a client.
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
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               address:
   *                 type: string
   *                 example: "123 Main St"
   *               city:
   *                 type: string
   *                 example: "Lagos"
   *               state:
   *                 type: string
   *                 example: "Lagos"
   *               country:
   *                 type: string
   *                 example: "Nigeria"
   *               bankName:
   *                 type: string
   *                 example: "First Bank"
   *               accountNumber:
   *                 type: string
   *                 example: "1234567890"
   *               accountName:
   *                 type: string
   *                 example: "John Doe Enterprises"
   *     responses:
   *       200:
   *         description: Registration details updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Registration details updated successfully"
   *                 client:
   *                   $ref: '#/components/schemas/Client'
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
   *                   example: "Failed to update registration details"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:id/registration", verifyToken, clientController.updateRegistration);

  /**
   * @swagger
   * /api/clients/{id}/approval-status:
   *   get:
   *     summary: Get client approval status
   *     description: Retrieves the registration approval status of a client.
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
   *         description: Approval status retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 approvalStatus:
   *                   type: string
   *                   enum: [pending, approved, rejected]
   *                   example: "pending"
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
   *                   example: "Failed to fetch approval status"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:id/approval-status", verifyToken, clientController.getApprovalStatus);

  /**
   * @swagger
   * /api/clients/{id}/approve:
   *   put:
   *     summary: Approve or reject client registration
   *     description: Updates the approval status of a client's registration.
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
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - approvalStatus
   *             properties:
   *               approvalStatus:
   *                 type: string
   *                 enum: [approved, rejected]
   *                 example: "approved"
   *     responses:
   *       200:
   *         description: Client registration approved or rejected
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Client registration approved"
   *                 client:
   *                   $ref: '#/components/schemas/Client'
   *       400:
   *         description: Invalid approval status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Invalid approval status. Must be 'approved' or 'rejected'"
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
   *                   example: "Failed to approve/reject client"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:id/approve", verifyToken, clientController.approveClient);

  /**
   * @swagger
   * /api/clients/login:
   *   post:
   *     summary: Login a client
   *     description: Authenticates a client and returns a JWT token. Requires email verification and approved registration.
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
   *                 example: "john.doe@example.com"
   *               password:
   *                 type: string
   *                 example: "password123"
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
   *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   *                 client:
   *                   $ref: '#/components/schemas/Client'
   *       400:
   *         description: Missing email or password
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "email and password are required"
   *       401:
   *         description: Invalid email or password
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Invalid email or password"
   *       403:
   *         description: Email not verified or registration not approved
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
   *     summary: Verify client email
   *     description: Verifies a client's email using an OTP.
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
   *                 example: "john.doe@example.com"
   *               otp:
   *                 type: string
   *                 example: "123456"
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
   *         description: Missing or invalid input, or OTP issues
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "email and otp are required"
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
   *     summary: Request password reset
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
   *                 example: "john.doe@example.com"
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
   *         description: Missing email
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
   *     summary: Reset client password
   *     description: Resets a client's password using an OTP.
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
   *                 example: "john.doe@example.com"
   *               otp:
   *                 type: string
   *                 example: "123456"
   *               newPassword:
   *                 type: string
   *                 example: "newpassword123"
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
   *         description: Missing or invalid input, or OTP issues
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "email, otp, and newPassword are required"
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
   * /api/clients/resend-otp:
   *   post:
   *     summary: Resend verification OTP
   *     description: Resends an OTP to the client's email for email verification.
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
   *                 example: "john.doe@example.com"
   *     responses:
   *       200:
   *         description: Verification OTP resent
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
   *                   example: "Failed to resend verification OTP"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/resend-otp", clientController.resendVerificationOTP);

  /**
   * @swagger
   * /api/clients:
   *   get:
   *     summary: Get all clients
   *     description: Retrieves a paginated list of all clients with optional search by firstName, lastName, or email.
   *     tags: [Clients]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: firstName
   *         schema:
   *           type: string
   *         description: Filter by first name (partial match)
   *         example: "John"
   *       - in: query
   *         name: lastName
   *         schema:
   *           type: string
   *         description: Filter by last name (partial match)
   *         example: "Doe"
   *       - in: query
   *         name: email
   *         schema:
   *           type: string
   *         description: Filter by email (partial match)
   *         example: "john.doe"
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
   *         description: Clients retrieved successfully
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
   *                       example: 1
   *                     totalItems:
   *                       type: integer
   *                       example: 10
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
   *                 message:
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
   *     summary: Get client by ID
   *     description: Retrieves details of a specific client by ID.
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
   *         description: Client retrieved successfully
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
   *                   example: "Failed to fetch client"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:id", verifyToken, clientController.getClientById);

  /**
   * @swagger
   * /api/clients/{id}:
   *   put:
   *     summary: Update client details
   *     description: Updates a client's basic details (firstName, lastName, email, phoneNumber, image).
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
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               firstName:
   *                 type: string
   *                 example: "John"
   *               lastName:
   *                 type: string
   *                 example: "Doe"
   *               email:
   *                 type: string
   *                 example: "john.doe@example.com"
   *               phoneNumber:
   *                 type: string
   *                 example: "+1234567890"
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: Optional profile image (JPEG, PNG, WebP, max 10MB)
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
   *       409:
   *         description: Email already in use
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Email already in use"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to update client"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:id", verifyToken, upload, uploadToFirebase, clientController.updateClient);

  /**
   * @swagger
   * /api/clients/{id}:
   *   delete:
   *     summary: Delete a client
   *     description: Deletes a client and their associated profile image.
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
   *                   example: "Failed to delete client"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:id", verifyToken, clientController.deleteClient);

  app.use("/api/clients", router);
};
