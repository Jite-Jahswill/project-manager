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
   *                   example: "Leave request created successfully"
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
   *         description: Missing required fields or invalid dates
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "startDate, endDate, and reason are required"
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
   *                   example: "Failed to create leave request"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/", verifyToken, leaveController.createLeave);

  /**
   * @swagger
   * /api/leaves:
   *   get:
   *     summary: Get all leave requests with optional search filters
   *     tags: [Leaves]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [approved, rejected, pending]
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
   *         description: Filter leaves by start date (exact match)
   *         example: "2025-08-01"
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date
   *         required: false
   *         description: Filter leaves by end date (exact match)
   *         example: "2025-08-05"
   *     responses:
   *       200:
   *         description: List of leave requests matching the search criteria
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
   *                   userId:
   *                     type: integer
   *                     example: 1
   *                   startDate:
   *                     type: string
   *                     format: date
   *                     example: "2025-08-01"
   *                   endDate:
   *                     type: string
   *                     format: date
   *                     example: "2025-08-05"
   *                   reason:
   *                     type: string
   *                     example: "Personal leave for family event"
   *                   status:
   *                     type: string
   *                     example: "pending"
   *                   User:
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
   *         description: Access denied - Unauthorized to view leaves
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized to view leaves"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch leave requests"
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
   *                 id:
   *                   type: integer
   *                   example: 1
   *                 userId:
   *                   type: integer
   *                   example: 1
   *                 startDate:
   *                   type: string
   *                   format: date
   *                   example: "2025-08-01"
   *                 endDate:
   *                   type: string
   *                   format: date
   *                   example: "2025-08-05"
   *                 reason:
   *                   type: string
   *                   example: "Personal leave for family event"
   *                 status:
   *                   type: string
   *                   example: "pending"
   *                 User:
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
   *         description: Access denied - Unauthorized to view this leave
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized to view this leave"
   *       404:
   *         description: Leave request not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Leave request not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to fetch leave request"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:id", verifyToken, leaveController.getLeaveById);

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
   *                 enum: ["approved", "rejected", "pending"]
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
   *                   example: "Leave request status updated successfully"
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
   *                   example: "Invalid status. Must be one of: approved, rejected, pending"
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
   *         description: Access denied - Only admins or managers can update leave status
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
   *                 error:
   *                   type: string
   *                   example: "Leave request not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to update leave status"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put(
    "/:id/status",
    verifyToken,
    isAdminOrManager,
    leaveController.updateLeaveStatus
  );

  /**
   * @swagger
   * /api/leaves/{id}:
   *   delete:
   *     summary: Delete a leave request
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
   *                   example: "Leave request deleted successfully"
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
   *         description: Access denied - Unauthorized to delete this leave
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Unauthorized to delete this leave"
   *       404:
   *         description: Leave request not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Leave request not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Failed to delete leave request"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:id", verifyToken, leaveController.deleteLeave);

  app.use("/api/leaves", router);
};
