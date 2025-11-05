const express = require("express");
const { upload, uploadToFirebase } = require("../middlewares/upload.middleware");
const hseReportController = require("../controllers/hse.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: HSE Reports
   *     description: Health, Safety, Environment (HSE) incident and safety reporting system
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *
   *   schemas:
   *     UserSummary:
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
   *           example: "john.doe@company.com"
   *
   *     HseDocument:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 5
   *         name:
   *           type: string
   *           example: "incident-photo.jpg"
   *         firebaseUrls:
   *           type: array
   *           items:
   *             type: string
   *           example: ["https://storage.googleapis.com/.../incident-photo.jpg"]
   *         type:
   *           type: string
   *           example: "image/jpeg"
   *         size:
   *           type: integer
   *           example: 245760
   *         uploadedBy:
   *           type: integer
   *           example: 1
   *         uploader:
   *           $ref: '#/components/schemas/UserSummary'
   *         reportId:
   *           type: integer
   *           nullable: true
   *           example: 3
   *         createdAt:
   *           type: string
   *           format: date-time
   *         updatedAt:
   *           type: string
   *           format: date-time
   *
   *     HSEReport:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 3
   *         title:
   *           type: string
   *           example: "Near Miss - Slip Hazard"
   *         dateOfReport:
   *           type: string
   *           format: date
   *           example: "2025-11-05"
   *         timeOfReport:
   *           type: string
   *           format: time
   *           example: "14:30:00"
   *         report:
   *           type: string
   *           example: "Worker slipped on wet floor near entrance. No injury."
   *         status:
   *           type: string
   *           enum: [open, pending, closed]
   *           default: open
   *           example: "open"
   *         closedAt:
   *           type: string
   *           format: date-time
   *           nullable: true
   *           example: null
   *         reporter:
   *           $ref: '#/components/schemas/UserSummary'
   *         closer:
   *           $ref: '#/components/schemas/UserSummary'
   *           nullable: true
   *         documents:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/HseDocument'
   *         createdAt:
   *           type: string
   *           format: date-time
   *         updatedAt:
   *           type: string
   *           format: date-time
   */

  /**
   * @swagger
   * /api/hse-reports:
   *   post:
   *     summary: Create a new HSE report
   *     description: |
   *       Creates a new HSE incident report with optional file uploads and/or attachment of existing documents.
   *       - Files are uploaded via `files[]` → processed by Firebase middleware → saved as `HseDocument`
   *       - Existing documents can be linked via `attachedDocIds`
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
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
   *                 example: "Near Miss - Slip Hazard"
   *               dateOfReport:
   *                 type: string
   *                 format: date
   *                 example: "2025-11-05"
   *               timeOfReport:
   *                 type: string
   *                 format: time
   *                 example: "14:30:00"
   *               report:
   *                 type: string
   *                 example: "Worker slipped on wet floor near entrance. No injury."
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Upload one or more supporting files (images, PDFs, etc.)
   *               attachedDocIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 example: [5, 8]
   *                 description: Optional array of existing HseDocument IDs to link
   *     responses:
   *       201:
   *         description: Report created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report created"
   *                 report:
   *                   $ref: '#/components/schemas/HSEReport'
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "title, dateOfReport, timeOfReport, and report are required"
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post(
    "/",
    verifyToken,
    hasPermission("hse:create"),
    upload,
    uploadToFirebase,
    hseReportController.createReport
  );

  /**
   * @swagger
   * /api/hse-reports/{id}:
   *   put:
   *     summary: Update an HSE report
   *     description: |
   *       Updates report details. Supports:
   *       - Adding new files
   *       - Attaching/detaching existing documents
   *       - Closing report (`status: "closed"`)
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
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               title:
   *                 type: string
   *               dateOfReport:
   *                 type: string
   *                 format: date
   *               timeOfReport:
   *                 type: string
   *                 format: time
   *               report:
   *                 type: string
   *               status:
   *                 type: string
   *                 enum: [open, pending, closed]
   *               closedBy:
   *                 type: integer
   *                 description: User ID who closed the report (optional if current user)
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *               attachedDocIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 description: Attach these existing documents
   *               detachDocIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 description: Unlink these documents from report
   *     responses:
   *       200:
   *         description: Report updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                 report:
   *                   $ref: '#/components/schemas/HSEReport'
   *       404:
   *         description: Report not found
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.put(
    "/:id",
    verifyToken,
    hasPermission("hse:update"),
    upload,
    uploadToFirebase,
    hseReportController.updateReport
  );

  /**
   * @swagger
   * /api/hse-reports/{id}:
   *   delete:
   *     summary: Delete an HSE report
   *     description: Soft-deletes the report. All linked documents are unlinked (not deleted).
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
   *     responses:
   *       200:
   *         description: Report deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Report deleted"
   *       404:
   *         description: Report not found
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.delete(
    "/:id",
    verifyToken,
    hasPermission("hse:delete"),
    hseReportController.deleteReport
  );

  /**
   * @swagger
   * /api/hse-reports/document/{documentId}:
   *   get:
   *     summary: Get HSE report by document ID
   *     description: Retrieves the report linked to a specific uploaded document.
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: documentId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 5
   *     responses:
   *       200:
   *         description: Report found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HSEReport'
   *       404:
   *         description: Document or linked report not found
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get(
    "/document/:documentId",
    verifyToken,
    hseReportController.getReportByDocumentId
  );

  /**
   * @swagger
   * /api/hse-reports/documents/{reportId}:
   *   get:
   *     summary: Get all documents for a report
   *     description: Returns all `HseDocument` records linked to the given report ID.
   *     tags: [HSE Reports]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: reportId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 3
   *     responses:
   *       200:
   *         description: List of documents
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 reportId:
   *                   type: integer
   *                 documents:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/HseDocument'
   *       404:
   *         description: Report not found
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get(
    "/documents/:reportId",
    verifyToken,
    hseReportController.getDocumentsByReportId
  );

  app.use("/api/hse-reports", router);
};
