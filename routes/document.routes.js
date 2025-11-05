const express = require("express");
const documentController = require("../controllers/document.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const { upload, uploadToFirebase } = require("../middlewares/upload.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Documents
   *     description: Project & report document management with optional report linking
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
   *         email: { type: string, example: "john.doe@example.com" }
   *
   *     ReportSummary:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 5 }
   *         title: { type: string, example: "Near Miss - Slip Hazard" }
   *
   *     Document:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 1 }
   *         name: { type: string, example: "incident-photo.jpg" }
   *         firebaseUrl: { type: string, example: "https://storage.../photo1.jpg" }
   *         projectId: { type: integer, example: 1 }
   *         reportId: { type: integer, nullable: true, example: 5 }
   *         type: { type: string, example: "image/jpeg" }
   *         size: { type: integer, example: 245000 }
   *         uploadedBy: { type: integer, example: 1 }
   *         status:
   *           type: string
   *           enum: [pending, approved, rejected, completed, "not complete"]
   *           example: "pending"
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   *         uploader: { $ref: '#/components/schemas/UserSummary' }
   *         report: { $ref: '#/components/schemas/ReportSummary', nullable: true }
   */

  /**
   * @swagger
   * /api/documents/{projectId}:
   *   post:
   *     summary: Upload documents to a project
   *     description: |
   *       Upload one or more files. Optionally link to a report (`reportId`).
   *       If `reportId` is provided, it **must belong to the same project**.
   *     tags: [Documents]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: projectId
   *         required: true
   *         schema: { type: integer }
   *         example: 1
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [files]
   *             properties:
   *               files:
   *                 type: array
   *                 items: { type: string, format: binary }
   *                 description: Max 10 files, 10MB each
   *               reportId:
   *                 type: integer
   *                 nullable: true
   *                 example: 5
   *                 description: Optional. Link to a report in this project.
   *     responses:
   *       201:
   *         description: Documents uploaded
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string }
   *                 documents:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/Document' }
   *       400: { description: Missing files or invalid reportId }
   *       404: { description: Project or Report not found }
   */
  router.post(
    "/:projectId",
    verifyToken,
    hasPermission("document:create"),
    upload,
    uploadToFirebase,
    documentController.createDocument
  );

  /**
   * @swagger
   * /api/documents:
   *   get:
   *     summary: Get all documents (global)
   *     description: |
   *       Filter by `projectId`, `reportId`, `status`, or `search`.
   *       Use `reportId=null` to get unattached documents.
   *     tags: [Documents]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: query
   *         name: projectId
   *         schema: { type: integer }
   *       - in: query
   *         name: reportId
   *         schema: { type: string }
   *         description: Use "null" for unattached
   *         example: "null"
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [pending, approved, rejected, completed, "not complete"]
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200:
   *         description: Paginated documents
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 documents:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/Document' }
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     currentPage: { type: integer }
   *                     totalPages: { type: integer }
   *                     totalItems: { type: integer }
   *                     itemsPerPage: { type: integer }
   */
  router.get("/", verifyToken, hasPermission("document:read"), documentController.getAllDocuments);

  /**
   * @swagger
   * /api/documents/{projectId}:
   *   get:
   *     summary: Get documents for a project
   *     description: |
   *       Optional `reportId` filter. Use `reportId=null` for unattached.
   *     tags: [Documents]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: projectId
   *         required: true
   *         schema: { type: integer }
   *       - in: query
   *         name: reportId
   *         schema: { type: string }
   *         example: "null"
   *       - in: query
   *         name: name
   *         schema: { type: string }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200:
   *         description: Documents for project
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 documents:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/Document' }
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     currentPage: { type: integer }
   *                     totalPages: { type: integer }
   *                     totalItems: { type: integer }
   *                     itemsPerPage: { type: integer }
   */
  router.get("/:projectId", verifyToken, hasPermission("document:read"), documentController.getDocumentsByProject);

  /**
   * @swagger
   * /api/documents/{documentId}:
   *   put:
   *     summary: Update document (name, file, or reportId)
   *     description: |
   *       Update name, replace file, or change `reportId`.
   *       - `reportId=null` → detach
   *       - `reportId=10` → attach to report #10 (must be same project)
   *     tags: [Documents]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: documentId
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               name: { type: string, example: "updated-photo.jpg" }
   *               files:
   *                 type: array
   *                 items: { type: string, format: binary }
   *                 maxItems: 1
   *               reportId:
   *                 type: integer
   *                 nullable: true
   *                 example: 10
   *     responses:
   *       200:
   *         description: Document updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string }
   *                 document: { $ref: '#/components/schemas/Document' }
   */
  router.put(
    "/:documentId",
    verifyToken,
    hasPermission("document:update"),
    upload,
    uploadToFirebase,
    documentController.updateDocument
  );

  /**
   * @swagger
   * /api/documents/{documentId}/status:
   *   put:
   *     summary: Update document status
   *     tags: [Documents]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: documentId
   *         required: true
   *         schema: { type: integer }
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
   *                 enum: [pending, approved, rejected, completed, "not complete"]
   *     responses:
   *       200:
   *         description: Status updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string }
   *                 document: { $ref: '#/components/schemas/Document' }
   */
  router.put(
    "/:documentId/status",
    verifyToken,
    hasPermission("document:update"),
    documentController.updateDocumentStatus
  );

  /**
   * @swagger
   * /api/documents/{documentId}:
   *   delete:
   *     summary: Delete document
   *     description: Deletes from DB and Firebase. Unlinks from report if attached.
   *     tags: [Documents]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: documentId
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Document deleted }
   */
  router.delete(
    "/:documentId",
    verifyToken,
    hasPermission("document:delete"),
    documentController.deleteDocument
  );

  app.use("/api/documents", router);
};
