const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const hseReportController = require("../controllers/hse.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   name: HSE Reports
   *   description: Manage incident/safety reports with optional file attachments
   */

  /**
   * @swagger
   * /api/hse/report:
   *   post:
   *     summary: Create a new HSE report
   *     description: Allows a user to submit a safety/incident report, optionally attaching Firebase file URLs.
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - dateOfReport
   *               - timeOfReport
   *               - report
   *             properties:
   *               dateOfReport:
   *                 type: string
   *                 format: date
   *                 example: "2025-11-03"
   *               timeOfReport:
   *                 type: string
   *                 example: "14:30"
   *               report:
   *                 type: string
   *                 example: "Oil spill detected near the storage tank area."
   *               firebaseUrls:
   *                 type: array
   *                 items:
   *                   type: string
   *                   example: "https://firebase.storage/photo.jpg"
   *     responses:
   *       201:
   *         description: Report created successfully
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post("/", verifyToken, hseReportController.createReport);

  /**
   * @swagger
   * /api/hse/report:
   *   get:
   *     summary: Get all HSE reports
   *     description: Fetch all reports with optional filters for status, search, and date range.
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [open, pending, closed]
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         example: "spill"
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Reports fetched successfully
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get("/", verifyToken, hseReportController.getAllReports);

  /**
   * @swagger
   * /api/hse/report/{id}:
   *   get:
   *     summary: Get single HSE report by ID
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 7
   *     responses:
   *       200:
   *         description: Report details retrieved
   *       404:
   *         description: Report not found
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get("/:id", verifyToken, hseReportController.getReportById);

  /**
   * @swagger
   * /api/hse/report/{id}:
   *   put:
   *     summary: Update an existing HSE report
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 3
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               report:
   *                 type: string
   *                 example: "Updated report description"
   *               firebaseUrls:
   *                 type: array
   *                 items:
   *                   type: string
   *                   example: "https://firebase.storage/newFile.jpg"
   *               status:
   *                 type: string
   *                 enum: [open, pending, closed]
   *               closedBy:
   *                 type: integer
   *                 example: 2
   *     responses:
   *       200:
   *         description: Report updated successfully
   *       404:
   *         description: Report not found
   *       500:
   *         description: Server error
   */
  router.put("/:id", verifyToken, hseReportController.updateReport);

  /**
   * @swagger
   * /api/hse/report/{id}:
   *   delete:
   *     summary: Delete an HSE report
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 4
   *     responses:
   *       200:
   *         description: Report deleted successfully
   *       404:
   *         description: Report not found
   *       500:
   *         description: Server error
   */
  router.delete("/:id", verifyToken, hseReportController.deleteReport);

  app.use("/api/hse/report", router);
};
