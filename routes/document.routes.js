const express = require("express");
const router = express.Router();
const { upload, uploadToFirebase } = require("../middlewares/upload.middleware");
const documentController = require("../controllers/document.controller");
const verifyToken = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Documents
   *     description: Project document management endpoints
   *
   * components:
   *   schemas:
   *     Document:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 1
   *         name:
   *           type: string
   *           example: "report.pdf"
   *         firebaseUrl:
   *           type: string
   *           example: "https://storage.googleapis.com/my-flxi-shop.appspot.com/Uploads/files-1234567890.pdf"
   *         projectId:
   *           type: integer
   *           example: 1
   *         type:
   *           type: string
   *           example: "pdf"
   *         size:
   *           type: integer
   *           example: 1048576
   *         uploadedBy:
   *           type: integer
   *           example: 1
   *         status:
   *           type: string
   *           enum: [pending, approved, rejected, completed, not complete]
   *           example: "pending"
   *         createdAt:
   *           type: string
   *           format: date-time
   *           example: "2025-10-26T04:34:00.000Z"
   *         updatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-10-26T04:34:00.000Z"
   *         uploader:
   *           type: object
   *           properties:
   *             id:
   *               type: integer
   *               example: 1
   *             firstName:
   *               type: string
   *               example: "John"
   *             lastName:
   *               type: string
   *               example: "Doe"
   *             email:
   *               type: string
   *               example: "john.doe@example.com"
   */

  /**
   * @swagger
   * /api/documents/{projectId}:
   *   post:
   *     summary: Upload documents for a project
   *     description: Allows authenticated users to upload one or more documents for a project. Documents are set to 'pending' status by default.
   *     tags: [Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Project ID
   *         example: 1
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Up to 10 files (JPEG, PNG, WebP, PDF, MP4, TXT, DOC, DOCX, XLS, XLSX, max 10MB each)
   *     responses:
   *       201:
   *         description: Documents uploaded successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Documents uploaded successfully"
   *                 documents:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Document'
   *       400:
   *         description: Missing projectId or no files uploaded
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "projectId is required"
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
   *       404:
   *         description: Project not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Project not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to upload documents"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.post("/:projectId", verifyToken, upload, uploadToFirebase, documentController.createDocument);

  /**
   * @swagger
   * /api/documents/{projectId}:
   *   get:
   *     summary: Get documents for a project
   *     description: Retrieves documents for a project, with optional name filtering and pagination. Accessible by authenticated users.
   *     tags: [Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Project ID
   *         example: 1
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         description: Page number for pagination
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 20
   *         description: Number of documents per page
   *         example: 20
   *       - in: query
   *         name: name
   *         schema:
   *           type: string
   *         description: Filter by document name (partial match)
   *         example: "report"
   *     responses:
   *       200:
   *         description: Documents retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 documents:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Document'
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     currentPage:
   *                       type: integer
   *                       example: 1
   *                     totalPages:
   *                       type: integer
   *                       example: 1
   *                     totalItems:
   *                       type: integer
   *                       example: 10
   *                     itemsPerPage:
   *                       type: integer
   *                       example: 20
   *       400:
   *         description: Missing or invalid projectId
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "projectId is required"
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
   *       404:
   *         description: Project not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Project not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to fetch documents"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.get("/:projectId", verifyToken, documentController.getDocumentsByProject);

  /**
   * @swagger
   * /api/documents/{documentId}:
   *   put:
   *     summary: Update a document's metadata
   *     description: Allows authenticated users to update a document's name or file (not status).
   *     tags: [Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: documentId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Document ID
   *         example: 1
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 example: "updated_report.pdf"
   *                 description: New document name
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: New file (max 1 file, JPEG, PNG, WebP, PDF, MP4, TXT, DOC, DOCX, XLS, XLSX, max 10MB)
   *     responses:
   *       200:
   *         description: Document updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Document updated successfully"
   *                 document:
   *                   $ref: '#/components/schemas/Document'
   *       400:
   *         description: Missing or invalid input
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "At least one field (name or file) is required"
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
   *       404:
   *         description: Document not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Document not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to update document"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:documentId", verifyToken, upload, uploadToFirebase, documentController.updateDocument);

  /**
   * @swagger
   * /api/documents/{documentId}/status:
   *   put:
   *     summary: Update a document's status
   *     description: Allows authenticated users to update a document's status (pending, approved, rejected, completed, not complete).
   *     tags: [Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: documentId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Document ID
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
   *                 enum: [pending, approved, rejected, completed, not complete]
   *                 example: "approved"
   *                 description: New document status
   *     responses:
   *       200:
   *         description: Document status updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Document status updated successfully"
   *                 document:
   *                   $ref: '#/components/schemas/Document'
   *       400:
   *         description: Missing or invalid status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "status is required"
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
   *       404:
   *         description: Document not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Document not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to update document status"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.put("/:documentId/status", verifyToken, documentController.updateDocumentStatus);

  /**
   * @swagger
   * /api/documents/{documentId}:
   *   delete:
   *     summary: Delete a document
   *     description: Allows authenticated users to delete a document and its file from Firebase.
   *     tags: [Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: documentId
   *         required: true
   *         schema:
   *           type: integer
   *         description: Document ID
   *         example: 1
   *     responses:
   *       200:
   *         description: Document deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Document deleted successfully"
   *       400:
   *         description: Missing documentId
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "documentId is required"
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
   *       404:
   *         description: Document not found
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Document not found"
   *       500:
   *         description: Internal server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Failed to delete document"
   *                 details:
   *                   type: string
   *                   example: "Database error"
   */
  router.delete("/:documentId", verifyToken, documentController.deleteDocument);

  app.use("/api/documents", router);
};
