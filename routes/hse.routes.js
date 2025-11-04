// routes/hse.routes.js
const express = require("express");
const hseController = require("../controllers/hse.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const { upload } = require("../middlewares/upload.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * /api/hse/report:
   *   post:
   *     summary: Submit a new HSE incident report
   *     description: Allows authenticated users to submit an HSE report. You can upload new evidence file(s) or reference an existing document by `hseDocumentId`.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
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
   *                 example: "2025-04-05"
   *                 description: Date when the incident occurred
   *               timeOfReport:
   *                 type: string
   *                 format: time
   *                 example: "14:30:00"
   *                 description: Time when the incident occurred
   *               report:
   *                 type: string
   *                 example: "Worker slipped on a wet floor near the loading bay."
   *                 description: Description of the incident
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: Optional. Upload one or more evidence files (images, PDFs, etc.)
   *               hseDocumentId:
   *                 type: integer
   *                 example: 12
   *                 description: Optional. Reference an existing document by ID instead of uploading a new one
   *     responses:
   *       201:
   *         description: HSE report submitted successfully
   *       400:
   *         description: Missing required fields or invalid input
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Referenced document not found
   *       500:
   *         description: Server error
   */
  router.post("/report", verifyToken, upload, hseController.createHSEReport);

  /**
   * @swagger
   * /api/hse/reports:
   *   get:
   *     summary: Get all HSE reports (admin access)
   *     description: Retrieves a paginated list of all HSE reports. Supports filtering by date range, status, and search.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *         description: Page number for pagination
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *         description: Number of reports per page
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search reports by text or reporter name
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [open, pending, closed]
   *         description: Filter reports by status
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         description: Filter reports from this start date
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date
   *         description: Filter reports until this end date
   *     responses:
   *       200:
   *         description: Paginated list of HSE reports
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Missing hse:read permission
   *       500:
   *         description: Server error
   */
  router.get(
    "/reports",
    verifyToken,
    hasPermission("hse:read"),
    hseController.getAllHSEReports
  );

  /**
   * @swagger
   * /api/hse/report/{id}:
   *   get:
   *     summary: Get a single HSE report by ID
   *     description: Fetches details of one HSE report, including reporter, closer, and attached documents.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 5
   *         description: ID of the HSE report
   *     responses:
   *       200:
   *         description: HSE report details
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Report not found
   *       500:
   *         description: Server error
   */
  router.get("/report/:id", verifyToken, hseController.getHSEReport);

  /**
   * @swagger
   * /api/hse/report/{id}:
   *   put:
   *     summary: Update an HSE report (admin only)
   *     description: Allows updating of report text, status, or document. Can upload new evidence file(s) or link an existing document using `hseDocumentId`.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 5
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               report:
   *                 type: string
   *                 example: "Updated incident report text."
   *               status:
   *                 type: string
   *                 enum: [open, pending, closed]
   *                 example: "closed"
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: Upload new evidence file(s)
   *               hseDocumentId:
   *                 type: integer
   *                 example: 10
   *                 description: Reference an existing document instead of uploading
   *     responses:
   *       200:
   *         description: Report updated successfully
   *       400:
   *         description: Invalid input or both file and hseDocumentId used
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Missing hse:update permission
   *       404:
   *         description: Report or document not found
   *       500:
   *         description: Server error
   */
  router.put(
    "/report/:id",
    verifyToken,
    hasPermission("hse:update"),
    upload,
    hseController.updateHSEReport
  );

  /**
   * @swagger
   * /api/hse/report/{id}:
   *   delete:
   *     summary: Delete an HSE report and its documents (admin only)
   *     description: Permanently removes an HSE report and all attached HSE documents.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 5
   *     responses:
   *       200:
   *         description: Report and attached documents deleted successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Missing hse:delete permission
   *       404:
   *         description: Report not found
   *       500:
   *         description: Server error
   */
  router.delete(
    "/report/:id",
    verifyToken,
    hasPermission("hse:delete"),
    hseController.deleteHSEReport
  );

  /**
   * @swagger
   * /api/hse/report/{reportId}/documents:
   *   get:
   *     summary: Get all documents attached to an HSE report
   *     description: Fetch all files linked to a specific HSE report.
   *     tags: [HSE Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: reportId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 7
   *     responses:
   *       200:
   *         description: List of documents for this report
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: No documents found
   *       500:
   *         description: Server error
   */
  router.get("/report/:reportId/documents", verifyToken, hseController.getHseDocuments);

  /**
   * @swagger
   * /api/hse/document/{id}:
   *   delete:
   *     summary: Delete a single HSE document
   *     description: Permanently removes a specific HSE document.
   *     tags: [HSE Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 9
   *     responses:
   *       200:
   *         description: Document deleted successfully
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Document not found
   *       500:
   *         description: Server error
   */
  router.delete("/document/:id", verifyToken, hseController.deleteHseDocument);

  app.use("/api/hse", router);
};
