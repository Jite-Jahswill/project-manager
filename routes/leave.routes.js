const express = require("express");
const leaveController = require("../controllers/leave.controller");
const {
  verifyToken,
  isAdminOrManager,
} = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Leaves
   *     description: Leave request management endpoints
   */

  /**
   * @swagger
   * /api/leaves:
   *   post:
   *     summary: Create a new leave request
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     userId:
   *                       type: integer
   *                       example: 1
   *                     startDate:
   *                       type: string
   *                       format: date
   *                       example: "2025-08-01"
   *                     endDate:
   *                       type: string
   *                       format: date
   *                       example: "2025-08-05"
   *                     reason:
   *                       type: string
   *                       example: "Personal leave for family event"
   *                     status:
   *                       type: string
   *                       example: "pending"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:13:00.000Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:13:00.000Z"
   *                     User:
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
   *         description: Unauthorized - Invalid or lacking a token
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
  router.post("/", verifyToken, leaveController.createLeave);

  /**
   * @swagger
   * /api/leaves:
   *   get:
   *     summary: Get all leave requests with optional filters
   *     description: Staff can view their own leaves. Admins and managers can view all leaves with filters.
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
   *         description: Filter leaves by user ID (admin/manager only)
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
   *           default: 1
   *         required: false
   *         description: Page number for pagination
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
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
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: integer
   *                         example: 1
   *                       userId:
   *                         type: integer
   *                         example: 1
   *                       startDate:
   *                         type: string
   *                         format: date
   *                         example: "2025-08-01"
   *                       endDate:
   *                         type: string
   *                         format: date
   *                         example: "2025-08-05"
   *                       reason:
   *                         type: string
   *                         example: "Personal leave for family event"
   *                       status:
   *                         type: string
   *                         example: "pending"
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *                         example: "2025-07-19T20:13:00.000Z"
   *                       updatedAt:
   *                         type: string
   *                         format: date-time
   *                         example: "2025-07-19T20:13:00.000Z"
   *                       User:
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
   *         description: Unauthorized - Invalid or lacking a token
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
  router.get("/", verifyToken, leaveController.getAllLeaves);

  /**
   * @swagger
   * /api/leaves/{id}:
   *   get:
   *     summary: Get a leave request by ID
   *     description: Staff can view their own leave requests. Admins and managers can view any leave request.
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     userId:
   *                       type: integer
   *                       example: 1
   *                     startDate:
   *                       type: string
   *                       format: date
   *                       example: "2025-08-01"
   *                     endDate:
   *                       type: string
   *                       format: date
   *                       example: "2025-08-05"
   *                     reason:
   *                       type: string
   *                       example: "Personal leave for family event"
   *                     status:
   *                       type: string
   *                       example: "pending"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:13:00.000Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:13:00.000Z"
   *                     User:
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
   *       401:
   *         description: Unauthorized - Invalid or lacking a token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       403:
   *         description: Forbidden - Staff cannot view others' leave requests
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to view this leave"
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
  router.get("/:id", verifyToken, leaveController.getLeaveById);

  /**
   * @swagger
   * /api/leaves/{id}:
   *   put:
   *     summary: Update a leave request
   *     description: Staff can update their own pending leave requests. Admins and managers can update any leave request.
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     userId:
   *                       type: integer
   *                       example: 1
   *                     startDate:
   *                       type: string
   *                       format: date
   *                       example: "2025-08-02"
   *                     endDate:
   *                       type: string
   *                       format: date
   *                       example: "2025-08-06"
   *                     reason:
   *                       type: string
   *                       example: "Updated: Extended personal leave"
   *                     status:
   *                       type: string
   *                       example: "pending"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:13:00.000Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:14:00.000Z"
   *                     User:
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
   *         description: Unauthorized - Invalid or lacking a token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       403:
   *         description: Forbidden - Staff cannot update others' leave requests
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized to update this leave"
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
  router.put("/:id", verifyToken, leaveController.updateLeave);

  /**
   * @swagger
   * /api/leaves/{id}/status:
   *   put:
   *     summary: Update leave request status (Admin or Manager only)
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
   *                   type: object
   *                   properties:
   *                     id:
   *                       type: integer
   *                       example: 1
   *                     userId:
   *                       type: integer
   *                       example: 1
   *                     startDate:
   *                       type: string
   *                       format: date
   *                       example: "2025-08-01"
   *                     endDate:
   *                       type: string
   *                       format: date
   *                       example: "2025-08-05"
   *                     reason:
   *                       type: string
   *                       example: "Personal leave for family event"
   *                     status:
   *                       type: string
   *                       example: "approved"
   *                     createdAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:13:00.000Z"
   *                     updatedAt:
   *                       type: string
   *                       format: date-time
   *                       example: "2025-07-19T20:14:00.000Z"
   *                     User:
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
   *       400:
   *         description: Invalid status or leave ID
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Status must be 'approved' or 'rejected'"
   *       401:
   *         description: Unauthorized - Invalid or lacking a token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       403:
   *         description: Forbidden - Only admins or managers can update leave status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can update leave status"
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
  router.put("/:id/status", verifyToken, isAdminOrManager, leaveController.updateLeaveStatus);

  /**
   * @swagger
   * /api/leaves/{id}:
   *   delete:
   *     summary: Delete a leave request (Admin or Manager only)
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
   *         description: Unauthorized - Invalid or lacking a token
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Unauthorized"
   *       403:
   *         description: Forbidden - Only admins or managers can delete leave requests
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Only admins or managers can delete leave requests"
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
  router.delete("/:id", verifyToken, isAdminOrManager, leaveController.deleteLeave);

  app.use("/api/leaves", router);
};
