const express = require("express");
const { upload, uploadToFirebase } = require("../middlewares/upload.middleware");
const authController = require("../controllers/auth.controller");
const verifyToken = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Authentication
   *     description: User authentication and management endpoints
   *
   * components:
   *   schemas:
   *     User:
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
   *         role:
   *           type: string
   *           enum: [admin, manager, staff]
   *           example: "staff"
   *         image:
   *           type: string
   *           example: "https://storage.googleapis.com/my-flxi-shop.appspot.com/Uploads/files-1234567890.jpg"
   */

  /**
   * @swagger
   * /api/auth/register:
   *   post:
   *     summary: Register a new user
   *     description: Creates a new user with an auto-generated password and sends an OTP for email verification. Requires an image upload.
   *     tags: [Authentication]
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
   *               - phoneNumber
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
   *               role:
   *                 type: string
   *                 enum: [admin, manager, staff]
   *                 example: "staff"
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: User profile image (JPEG, PNG, WebP, max 10MB)
   *     responses:
   *       201:
   *         description: User registered successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User registered successfully, OTP and password sent to email"
   *                 user:
   *                   $ref: '#/components/schemas/User'
   *       400:
   *         description: Missing or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "firstName, lastName, email, phoneNumber, and image are required"
   *       409:
   *         description: Email or phone number already in use
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Email already exists"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to register user"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/register", upload, uploadToFirebase, authController.register);

  /**
   * @swagger
   * /api/auth/login:
   *   post:
   *     summary: Login a user
   *     description: Authenticates a user and returns a JWT token.
   *     tags: [Authentication]
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
   *         description: Login successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Login successful"
   *                 token:
   *                   type: string
   *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   *                 user:
   *                   $ref: '#/components/schemas/User'
   *       400:
   *         description: Missing email or password
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Email and password are required"
   *       401:
   *         description: Invalid credentials
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Invalid credentials"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to login"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/login", authController.login);

  /**
   * @swagger
   * /api/auth/users:
   *   get:
   *     summary: Get all users
   *     description: Retrieves a paginated list of users with optional filtering by role, firstName, or lastName.
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: role
   *         schema:
   *           type: string
   *           enum: [admin, manager, staff]
   *         description: Filter by user role
   *         example: "staff"
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
   *         description: Number of users per page
   *         example: 20
   *     responses:
   *       200:
   *         description: Users retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 users:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/User'
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
   *                 error:
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
   *                   example: "Failed to fetch users"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/users", verifyToken, authController.getAllUsers);

  /**
   * @swagger
   * /api/auth/users/{id}:
   *   get:
   *     summary: Get a user by ID
   *     description: Retrieves details of a user by their ID.
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
   *         example: 1
   *     responses:
   *       200:
   *         description: User retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/User'
   *       400:
   *         description: Invalid user ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Invalid user ID"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch user"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/users/:id", verifyToken, authController.getUserById);

  /**
   * @swagger
   * /api/auth/users/{id}:
   *   put:
   *     summary: Update a user
   *     description: Updates user details (firstName, lastName, email, phoneNumber, image).
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
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
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: New profile image (JPEG, PNG, WebP, max 10MB)
   *     responses:
   *       200:
   *         description: User updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User updated successfully"
   *                 user:
   *                   $ref: '#/components/schemas/User'
   *       400:
   *         description: Invalid user ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Invalid user ID"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "User not found"
   *       409:
   *         description: Email or phone number already in use
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
   *                   example: "Failed to update user"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/users/:id", verifyToken, upload, uploadToFirebase, authController.updateUser);

  /**
   * @swagger
   * /api/auth/users/{id}/role:
   *   put:
   *     summary: Update a user's role
   *     description: Updates the role of a user (admin, manager, staff) and sends an email notification.
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
   *         example: 1
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - role
   *             properties:
   *               role:
   *                 type: string
   *                 enum: [admin, manager, staff]
   *                 example: "manager"
   *     responses:
   *       200:
   *         description: User role updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User role updated successfully"
   *                 user:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     firstName:
   *                       type: string
   *                       example: "John"
   *                     lastName:
   *                       type: string
   *                       example: "Doe"
   *                     email:
   *                       type: string
   *                       example: "john.doe@example.com"
   *                     role:
   *                       type: string
   *                       example: "manager"
   *       400:
   *         description: Invalid user ID or role
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Invalid role"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to update user role"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/users/:id/role", verifyToken, authController.updateUserRole);

  /**
   * @swagger
   * /api/auth/users/{id}:
   *   delete:
   *     summary: Delete a user
   *     description: Deletes a user by their ID.
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
   *         example: 1
   *     responses:
   *       200:
   *         description: User deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User deleted successfully"
   *       400:
   *         description: Invalid user ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Invalid user ID"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to delete user"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/users/:id", verifyToken, authController.deleteUser);

  /**
   * @swagger
   * /api/auth/verify-email:
   *   post:
   *     summary: Verify user email
   *     description: Verifies a user's email using an OTP.
   *     tags: [Authentication]
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
   *                 user:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     email:
   *                       type: string
   *                       example: "john.doe@example.com"
   *                     firstName:
   *                       type: string
   *                       example: "John"
   *                     lastName:
   *                       type: string
   *                       example: "Doe"
   *       400:
   *         description: Missing or invalid input, email already verified, or OTP issues
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Email and OTP are required"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to verify email"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/verify-email", authController.verifyEmail);

  /**
   * @swagger
   * /api/auth/forgot-password:
   *   post:
   *     summary: Request password reset
   *     description: Sends an OTP to the user's email for password reset.
   *     tags: [Authentication]
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
   *                 error:
   *                   type: string
   *                   example: "Email is required"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to send reset OTP"
   *                 details:
   *                   type: string
   *                   example: "Email service error"
   */
  router.post("/forgot-password", authController.forgotPassword);

  /**
   * @swagger
   * /api/auth/reset-password:
   *   post:
   *     summary: Reset user password
   *     description: Resets the user's password using an OTP.
   *     tags: [Authentication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - otp
   *               - password
   *             properties:
   *               email:
   *                 type: string
   *                 example: "john.doe@example.com"
   *               otp:
   *                 type: string
   *                 example: "123456"
   *               password:
   *                 type: string
   *                 example: "newpassword123"
   *     responses:
   *       200:
   *         description: Password reset successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Password reset successful"
   *       400:
   *         description: Missing or invalid input, or OTP issues
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Email, OTP, and password are required"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to reset password"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/reset-password", authController.resetPassword);

  /**
   * @swagger
   * /api/auth/resend-verification:
   *   post:
   *     summary: Resend verification OTP
   *     description: Resends an OTP for email verification to the authenticated user.
   *     tags: [Authentication]
   *     security:
   *       - bearerAuth: []
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
   *                   example: "Verification OTP resent successfully"
   *       400:
   *         description: Email already verified
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Email already verified"
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized"
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to resend verification OTP"
   *                 details:
   *                   type: string
   *                   example: "Email service error"
   */
  router.post("/resend-verification", verifyToken, authController.resendVerification);

  app.use("/api/auth", router);
};
