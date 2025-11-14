// routes/hse.routes.js
const express = require("express");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const { upload, uploadToFirebase } = require("../middlewares/upload.middleware");
const hseDocumentController = require("../controllers/hseDocument.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: HSE Documents
   *     description: Upload & manage HSE files (photos, PDFs, videos) with Firebase Storage
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
   *         id: { type: integer, example: 1 }
   *         firstName: { type: string, example: "John" }
   *         lastName: { type: string, example: "Doe" }
   *         email: { type: string, example: "john.doe@company.com" }
   *
   *     HSEReportSummary:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 4 }
   *         title: { type: string, example: "Near Miss - Slip Hazard" }
   *         status: { type: string, enum: [open, pending, closed], example: "open" }
   *
   *     HseDocument:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 12 }
   *         name: { type: string, example: "Wet Floor Incident Photo.jpg" }
   *         firebaseUrls:
   *           type: array
   *           items: { type: string }
   *           example: ["https://storage.googleapis.com/your-bucket/uploads/files-1699012345678.jpg"]
   *         type: { type: string, example: "image/jpeg" }
   *         size: { type: integer, example: 348921 }
   *         uploadedBy: { type: integer, example: 1 }
   *         reportId: { type: integer, nullable: true, example: 4 }
   *         uploader:
   *           $ref: '#/components/schemas/UserSummary'
   *         report:
   *           $ref: '#/components/schemas/HSEReportSummary'
   *           nullable: true
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   */

// CREATE / UPLOAD HSE DOCUMENTS
  /**
   * @swagger
   * /api/hse/documents:
   *   post:
   *     summary: Upload one or more HSE documents
   *     description: |
   *       Upload files to Firebase Storage. You can customize the display name using the `name` field.
   *       - If `name` is not provided → uses original filename
   *       - If `name` is provided → overrides filename (e.g., for better titles)
   *       - Optional: attach to HSE report via `reportId`
   *     tags: [HSE Documents]
   *     security: [bearerAuth: []]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required:
   *               - files
   *             properties:
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: One or more files (max 10 files, 10MB each)
   *               name:
   *                 type: string
   *                 example: "Incident Photo - Wet Floor Area"
   *                 description: |
   *                   Custom display name for the document.
   *                   If omitted, original filename is used.
   *               reportId:
   *                 type: string
   *                 nullable: true
   *                 example: "4"
   *                 description: Optional — link all uploaded files to this HSE report
   *     responses:
   *       201:
   *         description: Uploaded successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string, example: "Documents uploaded successfully" }
   *                 documents:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/HseDocument'
   *       400:
   *         description: No files uploaded
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Upload failed
   */
  router.post(
    "/",
    verifyToken,
    hasPermission("hsedocument:create"),
    upload,
    uploadToFirebase,
    hseDocumentController.createDocument
  );
  // ===================================================================
  // GET ALL DOCUMENTS (with filters)
  // ===================================================================
  /**
   * @swagger
   * /api/hse/documents:
   *   get:
   *     summary: List all HSE documents
   *     description: |
   *       Supports search, filtering by type/report/date, and pagination.
   *       Use `reportId=null` to get unattached documents.
   *     tags: [HSE Documents]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *         description: Search in filename
   *       - in: query
   *         name: type
   *         schema: { type: string }
   *         description: Filter by MIME type (e.g., image/jpeg)
   *       - in: query
   *         name: reportId
   *         schema: { type: string }
   *         description: Filter by report ID or use "null" for unattached
   *       - in: query
   *         name: startDate
   *         schema: { type: string, format: date }
   *         example: 2025-11-01
   *       - in: query
   *         name: endDate
   *         schema: { type: string, format: date }
   *         example: 2025-11-30
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20, maximum: 100 }
   *     responses:
   *       200:
   *         description: Paginated list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 documents:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/HseDocument' }
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     totalItems: { type: integer }
   *                     currentPage: { type: integer }
   *                     totalPages: { type: integer }
   *                     itemsPerPage: { type: integer }
   */
  router.get(
    "/",
    verifyToken,
    hasPermission("hsedocument:read"),
    hseDocumentController.getAllDocuments
  );

  // ===================================================================
  // GET SINGLE DOCUMENT
  // ===================================================================
  /**
   * @swagger
   * /api/hse/documents/{id}:
   *   get:
   *     summary: Get document by ID
   *     tags: [HSE Documents]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200:
   *         description: Document details
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/HseDocument' }
   *       404:
   *         description: Not found
   */
  router.get(
    "/:id",
    verifyToken,
    hasPermission("hsedocument:read"),
    hseDocumentController.getDocumentById
  );

  // ===================================================================
  // UPDATE DOCUMENT (Metadata + optional file replacement)
  // ===================================================================
  /**
   * @swagger
   * /api/hse/documents/{id}:
   *   put:
   *     summary: Update document metadata or replace file
   *     description: |
   *       - Update name, link to different report, or replace the file.
   *       - Old file in Firebase is automatically deleted.
   *     tags: [HSE Documents]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 example: "Corrected Incident Photo"
   *               reportId:
   *                 type: string
   *                 nullable: true
   *                 example: "null"
   *                 description: Set to "null" to detach from report
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Optional — upload new file to replace old one
   *     responses:
   *       200:
   *         description: Document updated
   *       404:
   *         description: Document not found
   */
  router.put(
    "/:id",
    verifyToken,
    hasPermission("hsedocument:update"),
    upload,           // optional new file
    uploadToFirebase,
    hseDocumentController.updateDocument
  );

  // ===================================================================
  // DELETE DOCUMENT
  // ===================================================================
  /**
   * @swagger
   * /api/hse/documents/{id}:
   *   delete:
   *     summary: Delete HSE document
   *     description: Permanently deletes record + file from Firebase Storage.
   *     tags: [HSE Documents]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200:
   *         description: Deleted successfully
   *       404:
   *         description: Not found
   */
  router.delete(
    "/:id",
    verifyToken,
    hasPermission("hsedocument:delete"),
    hseDocumentController.deleteDocument
  );

  // Mount router
  app.use("/api/hse/documents", router);
};
