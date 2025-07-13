const express = require("express");
const authController = require("../controllers/auth.controller");
const {
  verifyToken,
  isAdminOrManager,
} = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Auth
   *     description: Authentication and user management endpoints
   */

  /**
   * @swagger
   * /api/auth/register:
   *   post:
   *     summary: Register a new user
   *     tags: [Auth]
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
   *               - password
   *               - phoneNumber
   *             properties:
   *               firstName:
   *                 type: string
   *                 example: John
   *                 description: User's first name
   *               lastName:
   *                 type: string
   *                 example: Doe
   *                 description: User's last name
   *               email:
   *                 type: string
   *                 example: john.doe@example.com
   *                 description: User's email address
   *               password:
   *                 type: string
   *                 example: StrongPass123
   *                 description: User's password (minimum 8 characters)
   *               phoneNumber:
   *                 type: string
   *                 example: +1234567890
   *                 description: User's phone number
   *               image:
   *                 type: string
   *                 format: binary
   *                 description: Optional user profile image
   *     responses:
   *       201:
   *         description: User registered successfully, OTP sent to email
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: User registered successfully, OTP sent to email
   *                 user:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     firstName:
   *                       type: string
   *                       example: John
   *                     lastName:
   *                       type: string
   *                       example: Doe
   *                     email:
   *                       type: string
   *                       example: john.doe@example.com
   *                     phoneNumber:
   *                       type: string
   *                       example: +1234567890
   *                     image:
   *                       type: string
   *                       example: uploads/profiles/user1.jpg
   *                       nullable: true
   *                     role:
   *                       type: string
   *                       example: staff
   *       400:
   *         description: Missing required fields or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: All fields are required
   *       409:
   *         description: Email or phone number already exists
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Email already exists
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to register user
   *                 details:
   *                   type: string
   *                   example: Database error
   */
  router.post("/register", upload.single("image"), authController.register);

  /**
   * @swagger
   * /api/auth/login:
   *   post:
   *     summary: Log in a user
   *     tags: [Auth]
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
   *                 example: john.doe@example.com
   *                 description: User's email address
   *               password:
   *                 type: string
   *                 example: StrongPass123
   *                 description: User's password
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
   *                   example: Login successful
   *                 token:
   *                   type: string
   *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   *                 user:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     firstName:
   *                       type: string
   *                       example: John
   *                     lastName:
   *                       type: string
   *                       example: Doe
   *                     email:
   *                       type: string
   *                       example: john.doe@example.com
   *                     role:
   *                       type: string
   *                       example: staff
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Email and password are required
   *       401:
   *         description: Invalid credentials
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Invalid credentials
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: User not found
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to login
   *                 details:
   *                   type: string
   *                   example: Database error
   */
  router.post("/login", authController.login);

  /**
   * @swagger
   * /api/auth/verify-email:
   *   post:
   *     summary: Verify a user's email address using OTP
   *     tags: [Auth]
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
   *                 example: john.doe@example.com
   *                 description: User's email address
   *               otp:
   *                 type: string
   *                 example: "123456"
   *                 description: 6-digit OTP sent to the user's email
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
   *                   example: Email verified successfully
   *                 user:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     email:
   *                       type: string
   *                       example: john.doe@example.com
   *                     firstName:
   *                       type: string
   *                       example: John
   *                     lastName:
   *                       type: string
   *                       example: Doe
   *       400:
   *         description: Invalid or expired OTP, or email already verified
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Invalid OTP
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: User not found
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to verify email
   *                 details:
   *                   type: string
   *                   example: Database error
   */
  router.post("/verify-email", authController.verifyEmail);

  /**
   * @swagger
   * /api/auth/resend-verification:
   *   post:
   *     summary: Resend email verification OTP to a logged-in user
   *     tags: [Auth]
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
   *                   example: Verification OTP resent successfully
   *       400:
   *         description: Email already verified
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Email already verified
   *       401:
   *         description: Unauthorized - Invalid or missing token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Unauthorized
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: User not found
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to resend verification OTP
   *                 details:
   *                   type: string
   *                   example: Email service error
   */
  router.post("/resend-verification", verifyToken, authController.resendVerification);

  /**
   * @swagger
   * /api/auth/forgot-password:
   *   post:
   *     summary: Send a password reset OTP to the user's email
   *     tags: [Auth]
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
   *                 example: john.doe@example.com
   *                 description: User's email address
   *     responses:
   *       200:
   *         description: Password reset OTP sent to email
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Password reset OTP sent to email
   *       400:
   *         description: Email is required
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Email is required
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: User not found
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to send reset OTP
   *                 details:
   *                   type: string
   *                   example: Email service error
   */
  router.post("/forgot-password", authController.forgotPassword);

  /**
   * @swagger
   * /api/auth/reset-password:
   *   post:
   *     summary: Reset user password using OTP
   *     tags: [Auth]
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
   *                 example: john.doe@example.com
   *                 description: User's email address
   *               otp:
   *                 type: string
   *                 example: "123456"
   *                 description: 6-digit OTP sent to the user's email
   *               password:
   *                 type: string
   *                 example: NewStrongPass123
   *                 description: New user password (minimum 8 characters)
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
   *                   example: Password reset successful
   *       400:
   *         description: Invalid or expired OTP, or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Invalid OTP
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: User not found
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to reset password
   *                 details:
   *                   type: string
   *                   example: Database error
   */
  router.post("/reset-password", authController.resetPassword);

  /**
   * @swagger
   * /api/auth/users:
   *   get:
   *     summary: Get all users (Admin or Manager only)
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: role
   *         schema:
   *           type: string
   *         description: Filter users by role
   *         example: staff
   *       - in: query
   *         name: firstName
   *         schema:
   *           type: string
   *         description: Filter users by first name (partial match)
   *         example: John
   *       - in: query
   *         name: lastName
   *         schema:
   *           type: string
   *         description: Filter users by last name (partial match)
   *         example: Doe
   *     responses:
   *       200:
   *         description: List of all users
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
   *                     example: John
   *                   lastName:
   *                     type: string
   *                     example: Doe
   *                   email:
   *                     type: string
   *                     example: john.doe@example.com
   *                   role:
   *                     type: string
   *                     example: staff
   *                   image:
   *                     type: string
   *                     example: uploads/profiles/user1.jpg
   *                     nullable: true
   *                   phoneNumber:
   *                     type: string
   *                     example: +1234567890
   *                     nullable: true
   *       403:
   *         description: Access denied - Only admins or managers can view users
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Only admins or managers can view users
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to fetch users
   *                 details:
   *                   type: string
   *                   example: Database error
   */
  router.get(
    "/users",
    verifyToken,
    isAdminOrManager,
    authController.getAllUsers
  );

  /**
   * @swagger
   * /api/auth/users/{id}:
   *   get:
   *     summary: Get a user by ID
   *     tags: [Auth]
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
   *         description: User details
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
   *                   example: John
   *                 lastName:
   *                   type: string
   *                   example: Doe
   *                 email:
   *                   type: string
   *                   example: john.doe@example.com
   *                 role:
   *                   type: string
   *                   example: staff
   *                 image:
   *                   type: string
   *                   example: uploads/profiles/user1.jpg
   *                   nullable: true
   *                 phoneNumber:
   *                   type: string
   *                   example: +1234567890
   *                   nullable: true
   *       400:
   *         description: Invalid user ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Invalid user ID
   *       403:
   *         description: Unauthorized access to user data
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Unauthorized to view this user
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: User not found
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to fetch user
   *                 details:
   *                   type: string
   *                   example: Database error
   */
  router.get("/users/:id", verifyToken, authController.getUserById);

  /**
   * @swagger
   * /api/auth/users/{id}:
   *   put:
   *     summary: Update user information (except role)
   *     tags: [Auth]
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
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               firstName:
   *                 type: string
   *                 example: John
   *                 description: User's first name
   *               lastName:
   *                 type: string
   *                 example: Doe
   *                 description: User's last name
   *               email:
   *                 type: string
   *                 example: john.doe@example.com
   *                 description: User's email address
   *               phoneNumber:
   *                 type: string
   *                 example: +1234567890
   *                 description: User's phone number
   *               image:
   *                 type: string
   *                 format: binary
   *                 description: Optional user profile image
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
   *                   example: User updated successfully
   *                 user:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     firstName:
   *                       type: string
   *                       example: John
   *                     lastName:
   *                       type: string
   *                       example: Doe
   *                     email:
   *                       type: string
   *                       example: john.doe@example.com
   *                     phoneNumber:
   *                       type: string
   *                       example: +1234567890
   *                     image:
   *                       type: string
   *                       example: uploads/profiles/user1.jpg
   *                       nullable: true
   *                     role:
   *                       type: string
   *                       example: staff
   *       400:
   *         description: Invalid user ID or input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Invalid user ID
   *       403:
   *         description: Unauthorized to update this user
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Unauthorized to update this user
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: User not found
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to update user
   *                 details:
   *                   type: string
   *                   example: Database error
   */
  router.put(
    "/users/:id",
    verifyToken,
    upload.single("image"),
    authController.updateUser
  );

  /**
   * @swagger
   * /api/auth/users/{id}/role:
   *   patch:
   *     summary: Update a user's role (Admin or Manager only)
   *     tags: [Auth]
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
   *                 example: manager
   *                 description: New role for the user (e.g., admin, manager, staff)
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
   *                   example: User role updated successfully
   *                 user:
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                     firstName:
   *                       type: string
   *                       example: John
   *                     lastName:
   *                       type: string
   *                       example: Doe
   *                     email:
   *                       type: string
   *                       example: john.doe@example.com
   *                     role:
   *                       type: string
   *                       example: manager
   *       400:
   *         description: Invalid user ID or role
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Invalid role
   *       403:
   *         description: Access denied - Only admins or managers can update roles
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Only admins or managers can update roles
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: User not found
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to update user role
   *                 details:
   *                   type: string
   *                   example: Database error
   */
  router.patch(
    "/users/:id/role",
    verifyToken,
    isAdminOrManager,
    authController.updateUserRole
  );

  /**
   * @swagger
   * /api/auth/users/{id}:
   *   delete:
   *     summary: Delete a user
   *     tags: [Auth]
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
   *                   example: User deleted successfully
   *       400:
   *         description: Invalid user ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Invalid user ID
   *       403:
   *         description: Unauthorized to delete this user
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: Unauthorized to delete this user
   *       404:
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: User not found
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: Failed to delete user
   *                 details:
   *                   type: string
   *                   example: Database error
   */
  router.delete("/users/:id", verifyToken, authController.deleteUser);

  app.use("/api/auth", router);
};
