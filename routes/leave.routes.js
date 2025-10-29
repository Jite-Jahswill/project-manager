const express = require("express");
const leaveController = require("../controllers/leave.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Leaves
   *     description: Leave request management endpoints
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *   schemas:
   *     Leave:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         userId:
   *           type: integer
   *           example: 1
   *         startDate:
   *           type: string
   *           format: date
   *           example: "2025-08-01"
   *         endDate:
   *           type: string
   *           format: date
   *           example: "2025-08-05"
   *         reason:
   *           type: string
   *           example: "Personal leave for family event"
   *         status:
   *           type: string
   *           enum: [pending, approved, rejected]
   *           example: "pending"
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T20:13:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T20:13:00.000Z"
   *         User:
   *           type: object
   *           properties:
   *             id:
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
   * /api/leaves:
   *   post:
   *     summary: Create a new leave request
   *     description: Creates a new leave request for the authenticated user. Notifies admins and managers via email.
   *     tags: [Leaves]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - startDate
   *               - endDate
   *               - reason
   *             properties:
   *               startDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-08-01"
   *                 description: Start date of the leave
   *               endDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-08-05"
   *                 description: End date of the leave
   *               reason:
   *                 type: string
   *                 example: "Personal leave for family event"
   *                 description: Reason for the leave request
   *     responses:
   *       201:
   *         description: Leave request created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Leave created successfully"
   *                 leave:
   *                   $ref: '#/components/schemas/Leave'
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "All fields are required"
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
   *         description: User not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "User not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error creating leave"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/", verifyToken, hasPermission("leave:create"), leaveController.createLeave);

  /**
   * @swagger
   * /api/leaves:
   *   get:
   *     summary: Get all leave requests with optional filters
   *     description: Retrieves a paginated list of all leave requests with optional filters for status, userId, startDate, and endDate. Accessible to any authenticated user.
   *     tags: [Leaves]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [pending, approved, rejected]
   *         required: false
   *         description: Filter leaves by status
   *         example: "pending"
   *       - in: query
   *         name: userId
   *         schema:
   *           type: integer
   *         required: false
   *         description: Filter leaves by user ID
   *         example: 1
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         required: false
   *         description: Filter leaves starting on or after this date
   *         example: "2025-08-01"
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date
   *         required: false
   *         description: Filter leaves ending on or before this date
   *         example: "2025-08-05"
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         required: false
   *         description: Page number for pagination
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 20
   *         required: false
   *         description: Number of items per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of leave requests
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 leaves:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Leave'
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
   *                 message:
   *                   type: string
   *                   example: "Error fetching leaves"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/", verifyToken, hasPermission("leave:read"), leaveController.getAllLeaves);

  /**
   * @swagger
   * /api/leaves/user/{userId}:
   *   get:
   *     summary: Get all leave requests for a specific user
   *     description: Retrieves a paginated list of leave requests for a specific user ID with optional filters for status, startDate, and endDate. Accessible to any authenticated user.
   *     tags: [Leaves]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID to fetch leaves for
   *         example: 1
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [pending, approved, rejected]
   *         required: false
   *         description: Filter leaves by status
   *         example: "pending"
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         required: false
   *         description: Filter leaves starting on or after this date
   *         example: "2025-08-01"
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date
   *         required: false
   *         description: Filter leaves ending on or before this date
   *         example: "2025-08-05"
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         required: false
   *         description: Page number for pagination
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 20
   *         required: false
   *         description: Number of items per page
   *         example: 20
   *     responses:
   *       200:
   *         description: List of leave requests for the user
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 leaves:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Leave'
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
   *       404:
   *         description: No leaves found for this user
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "No leaves found for this user"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error fetching leaves by user ID"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/user/:userId", verifyToken, hasPermission("leave:read"), leaveController.getLeavesByUserId);

  /**
   * @swagger
   * /api/leaves/{id}:
   *   get:
   *     summary: Get a leave request by ID
   *     description: Retrieves a specific leave request by ID. Accessible to any authenticated user.
   *     tags: [Leaves]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Leave request ID
   *         example: 1
   *     responses:
   *       200:
   *         description: Leave request details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 leave:
   *                   $ref: '#/components/schemas/Leave'
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
   *         description: Leave request not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Leave not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error retrieving leave"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:id", verifyToken, hasPermission("leave:read"), leaveController.getLeaveById);

  /**
   * @swagger
   * /api/leaves/{id}:
   *   put:
   *     summary: Update a leave request
   *     description: Updates a pending leave request. Accessible to any authenticated user, but only pending leaves can be updated. Notifies admins and managers via email.
   *     tags: [Leaves]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Leave request ID
   *         example: 1
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               startDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-08-02"
   *                 description: Updated start date of the leave
   *               endDate:
   *                 type: string
   *                 format: date
   *                 example: "2025-08-06"
   *                 description: Updated end date of the leave
   *               reason:
   *                 type: string
   *                 example: "Updated: Extended personal leave"
   *                 description: Updated reason for the leave request
   *     responses:
   *       200:
   *         description: Leave request updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Leave updated successfully"
   *                 leave:
   *                   $ref: '#/components/schemas/Leave'
   *       400:
   *         description: Invalid input or leave not pending
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "At least one field (startDate, endDate, reason) is required"
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
   *         description: Leave request not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Leave not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error updating leave"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:id", verifyToken, hasPermission("leave:update"), leaveController.updateLeave);

  /**
   * @swagger
   * /api/leaves/{id}/status:
   *   put:
   *     summary: Update leave request status
   *     description: Updates the status of a leave request to approved or rejected. Accessible to any authenticated user. Notifies the leave owner via email.
   *     tags: [Leaves]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Leave request ID
   *         example: 1
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - status
   *             properties:
   *               status:
   *                 type: string
   *                 enum: [approved, rejected]
   *                 example: "approved"
   *                 description: New status for the leave request
   *     responses:
   *       200:
   *         description: Leave request status updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Leave status updated successfully"
   *                 leave:
   *                   $ref: '#/components/schemas/Leave'
   *       400:
   *         description: Invalid status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Status must be 'approved' or 'rejected'"
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
   *         description: Leave request not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Leave not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error updating leave status"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:id/status", verifyToken, hasPermission("leave:update"), leaveController.updateLeaveStatus);

  /**
   * @swagger
   * /api/leaves/{id}:
   *   delete:
   *     summary: Delete a leave request
   *     description: Deletes a leave request. Accessible to any authenticated user. Notifies the leave owner via email.
   *     tags: [Leaves]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: Leave request ID
   *         example: 1
   *     responses:
   *       200:
   *         description: Leave request deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Leave deleted successfully"
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
   *         description: Leave request not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Leave not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Error deleting leave"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:id", verifyToken, hasPermission("leave:delete"), leaveController.deleteLeave);

  app.use("/api/leaves", router);
};
