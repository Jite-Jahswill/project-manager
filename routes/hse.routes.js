const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const hseReportController = require("../controllers/hse.controller");

/**
 * @swagger
 * tags:
 *   name: HSE Reports
 *   description: API endpoints for managing Health, Safety, and Environment reports
 */

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * /api/hse/create:
   *   post:
   *     summary: Create a new HSE report
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
   *               - title
   *               - dateOfReport
   *               - timeOfReport
   *               - report
   *             properties:
   *               title:
   *                 type: string
   *                 example: "Oil Spill Incident"
   *               dateOfReport:
   *                 type: string
   *                 format: date
   *                 example: "2025-11-02"
   *               timeOfReport:
   *                 type: string
   *                 format: time
   *                 example: "14:30:00"
   *               report:
   *                 type: string
   *                 example: "Oil spill occurred near the maintenance yard."
   *               firebaseUrls:
   *                 type: array
   *                 items:
   *                   type: string
   *                   example: "https://firebasestorage.googleapis.com/v0/b/files/report1.jpg"
   *               attachedDocs:
   *                 type: array
   *                 items:
   *                   type: integer
   *                   example: 12
   *     responses:
   *       201:
   *         description: Report created successfully
   *       400:
   *         description: Missing required fields
   *       500:
   *         description: Failed to create report
   */
  router.post("/hse/create", verifyToken, hseReportController.createReport);

  /**
   * @swagger
   * /api/hse/update/{id}:
   *   put:
   *     summary: Update an existing HSE report
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         schema:
   *           type: integer
   *         required: true
   *         description: HSE report ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title:
   *                 type: string
   *                 example: "Updated Oil Spill Report"
   *               report:
   *                 type: string
   *                 example: "Oil spill contained successfully."
   *               firebaseUrls:
   *                 type: array
   *                 items:
   *                   type: string
   *               attachedDocs:
   *                 type: array
   *                 items:
   *                   type: integer
   *               status:
   *                 type: string
   *                 enum: [open, pending, closed]
   *                 example: "closed"
   *               closedBy:
   *                 type: integer
   *                 example: 3
   *     responses:
   *       200:
   *         description: Report updated successfully
   *       404:
   *         description: Report not found
   *       500:
   *         description: Failed to update report
   */
  router.put("/hse/update/:id", verifyToken, hseReportController.updateReport);

  /**
   * @swagger
   * /api/hse/delete/{id}:
   *   delete:
   *     summary: Delete an HSE report by ID
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         schema:
   *           type: integer
   *         required: true
   *         description: HSE report ID
   *     responses:
   *       200:
   *         description: Report deleted successfully
   *       404:
   *         description: Report not found
   *       500:
   *         description: Failed to delete report
   */
  router.delete("/hse/delete/:id", verifyToken, hseReportController.deleteReport);

  /**
   * @swagger
   * /api/hse/by-document/{documentId}:
   *   get:
   *     summary: Get a report by its linked document ID
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: documentId
   *         schema:
   *           type: integer
   *         required: true
   *         description: Document ID
   *     responses:
   *       200:
   *         description: Returns the linked HSE report with documents and reporter info
   *       404:
   *         description: Document or report not found
   *       500:
   *         description: Failed to fetch report
   */
  router.get("/hse/by-document/:documentId", verifyToken, hseReportController.getReportByDocumentId);

  /**
   * @swagger
   * /api/hse/documents/{reportId}:
   *   get:
   *     summary: Get all documents linked to a specific HSE report
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: reportId
   *         schema:
   *           type: integer
   *         required: true
   *         description: HSE report ID
   *     responses:
   *       200:
   *         description: Returns all documents linked to the given report
   *       404:
   *         description: Report not found
   *       500:
   *         description: Failed to fetch documents
   */
  router.get("/hse/documents/:reportId", verifyToken, hseReportController.getDocumentsByReportId);

  app.use("/api", router);
};
