const express = require("express");
const hseController = require("../controllers/hse.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const { upload } = require("../middlewares/upload.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   name: HSE
   *   description: Health, Safety, and Environment Reports Management
   */

  /**
   * @swagger
   * /api/hse/report:
   *   post:
   *     summary: Submit a new HSE incident report
   *     description: Allows authenticated users to submit an HSE report. You can upload multiple evidence files such as images, PDFs, etc.
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
   *               timeOfReport:
   *                 type: string
   *                 format: time
   *                 example: "14:30:00"
   *               report:
   *                 type: string
   *                 example: "Worker slipped on a wet floor near the loading bay."
   *               file:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Optional. Upload one or more supporting documents.
   *     responses:
   *       201:
   *         description: HSE report created successfully
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post("/report", verifyToken, upload, hseController.createHSEReport);

  /**
   * @swagger
   * /api/hse/reports:
   *   get:
   *     summary: Get all HSE reports
   *     description: Retrieves a paginated list of HSE reports. Supports filtering by date, status, and search text.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search reports by content or reporter name
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [open, pending, closed]
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
   *     responses:
   *       200:
   *         description: Paginated list of reports
   *       401:
   *         description: Unauthorized
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
   *     summary: Get a specific HSE report
   *     description: Fetch details of one HSE report including reporter, closer, and attached documents.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *           example: 5
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
   *     summary: Update an HSE report
   *     description: Update report details, status, or attach new documents. Supports file upload.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *           example: 5
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               report:
   *                 type: string
   *                 example: "Updated report text."
   *               status:
   *                 type: string
   *                 enum: [open, pending, closed]
   *                 example: "closed"
   *               file:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Optional. Upload additional evidence files.
   *     responses:
   *       200:
   *         description: Report updated successfully
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Missing hse:update permission
   *       404:
   *         description: Report not found
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
   *     summary: Delete an HSE report and its documents
   *     description: Permanently removes a report and all its attached documents.
   *     tags: [HSE]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *           example: 5
   *     responses:
   *       200:
   *         description: Report deleted successfully
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
   *     summary: Get all documents for an HSE report
   *     description: Fetch all files attached to a specific HSE report.
   *     tags: [HSE Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: reportId
   *         required: true
   *         schema:
   *           type: integer
   *           example: 7
   *     responses:
   *       200:
   *         description: List of documents
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: No documents found
   *       500:
   *         description: Server error
   */
  router.get(
    "/report/:reportId/documents",
    verifyToken,
    hseController.getHseDocuments
  );

  /**
   * @swagger
   * /api/hse/document/{id}:
   *   delete:
   *     summary: Delete an HSE document
   *     description: Permanently removes a specific document from storage.
   *     tags: [HSE Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *           example: 9
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
  router.delete(
    "/document/:id",
    verifyToken,
    hseController.deleteHseDocument
  );

  app.use("/api/hse", router);
};
