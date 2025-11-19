// routes/training.routes.js
const express = require("express");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const trainingController = require("../controllers/training.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Training Tracker
   *     description: Full safety training management – scheduling, progress tracking, reminders & compliance
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *
   *   schemas:
   *     Training:
   *       type: object
   *       properties:
   *         id: { type: integer }
   *         courseName: { type: string, example: "Confined Space Entry" }
   *         nextTrainingDate: { type: string, format: date, example: "2025-06-15" }
   *         status:
   *           type: string
   *           enum: [Scheduled, In Progress, Urgent, Completed, Cancelled]
   *           example: "In Progress"
   *         progress: { type: integer, minimum: 0, maximum: 100, example: 75 }
   *         reminderSentAt: { type: string, format: date-time, nullable: true }
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   *         attendees:
   *           type: array
   *           items:
   *             type: object
   *             properties:
   *               id: { type: integer }
   *               firstName: { type: string }
   *               lastName: { type: string }
   *               email: { type: string }
   *               department: { type: string, nullable: true }
   *
   *     Pagination:
   *       type: object
   *       properties:
   *         total: { type: integer }
   *         page: { type: integer }
   *         totalPages: { type: integer }
   *         itemsPerPage: { type: integer }
   */

  // ──────────────────────────────────────────────────────────────
  // ROUTES
  // ──────────────────────────────────────────────────────────────

  /**
   * @swagger
   * /api/training:
   *   post:
   *     summary: Create new training course with attendees
   *     tags: [Training Tracker]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [courseName, nextTrainingDate, attendeeIds]
   *             properties:
   *               courseName: { type: string }
   *               nextTrainingDate: { type: string, format: date }
   *               attendeeIds: { type: array, items: { type: integer }, example: [3, 7, 12] }
   *     responses:
   *       201: { description: Training created + email sent to all attendees }
   *       400: { description: Missing required fields }
   */
  router.post("/", verifyToken, hasPermission("training:create"), trainingController.createTraining);

  /**
   * @swagger
   * /api/training:
   *   get:
   *     summary: Get all trainings (search + pagination)
   *     tags: [Training Tracker]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *         description: Search by course name
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200:
   *         description: List of trainings
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 trainings: { type: array, items: { $ref: '#/components/schemas/Training' } }
   *                 pagination: { $ref: '#/components/schemas/Pagination' }
   */
  router.get("/", verifyToken, hasPermission("training:view"), trainingController.getAllTrainings);

  /**
   * @swagger
   * /api/training/{id}:
   *   get:
   *     summary: Get single training with full attendee list
   *     tags: [Training Tracker]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Training details }
   *       404: { description: Not found }
   */
  router.get("/:id", verifyToken, hasPermission("training:view"), trainingController.getTrainingById);

  /**
   * @swagger
   * /api/training/{id}:
   *   put:
   *     summary: Update training (course name, date, progress, status) – RAW MySQL
   *     tags: [Training Tracker]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               courseName: { type: string }
   *               nextTrainingDate: { type: string, format: date }
   *               progress: { type: integer, minimum: 0, maximum: 100 }
   *               status: { type: string, enum: [Scheduled, In Progress, Urgent, Completed, Cancelled] }
   *     responses:
   *       200: { description: Training updated (auto status on progress 100%) }
   */
  router.put("/:id", verifyToken, hasPermission("training:update"), trainingController.updateTraining);

  /**
   * @swagger
   * /api/training/{id}/status:
   *   patch:
   *     summary: Update only status (quick action)
   *     tags: [Training Tracker]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [status]
   *             properties:
   *               status:
   *                 type: string
   *                 enum: [Scheduled, In Progress, Urgent, Completed, Cancelled]
   *     responses:
   *       200: { description: Status updated + email notification }
   */
  router.patch("/:id/status", verifyToken, hasPermission("training:update"), trainingController.updateStatus);

  /**
   * @swagger
   * /api/training/{id}/remind:
   *   post:
   *     summary: Send reminder email to ALL attendees + admins (one-click button)
   *     tags: [Training Tracker]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Reminder sent successfully }
   */
  router.post("/:id/remind", verifyToken, hasPermission("training:remind"), trainingController.sendReminder);

  /**
   * @swagger
   * /api/training/{id}:
   *   delete:
   *     summary: Delete training (cancels and notifies everyone)
   *     tags: [Training Tracker]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Training deleted + cancellation email sent }
   */
  router.delete("/:id", verifyToken, hasPermission("training:update"), trainingController.deleteTraining);

  // Mount route
  app.use("/api/training", router);
};
