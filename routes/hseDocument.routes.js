const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const hseDocumentController = require("../controllers/hseDocument.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: HSE Documents
   *     description: Manage uploaded HSE files (images, PDFs, etc.) and link them to reports
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
   *     HSEReportSummary:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 4
   *         title:
   *           type: string
   *           example: "Near Miss - Slip Hazard"
   *         status:
   *           type: string
   *           enum: [open, pending, closed]
   *           example: "open"
   *
   *     HseDocument:
   *       type: object
   *       properties:
   *         id:
   *           type: integer
   *           example: 5
   *         name:
   *           type: string
   *           example: "Incident Photo - Wet Floor"
   *         firebaseUrls:
   *           type: array
   *           items:
   *             type: string
   *           example: ["https://storage.googleapis.com/.../photo1.jpg"]
   *         type:
   *           type: string
   *           example: "image/jpeg"
   *         size:
   *           type: integer
   *           example: 245760
   *         uploadedBy:
   *           type: integer
   *           example: 1
   *         reportId:
   *           type: integer
   *           nullable: true
   *           example: 4
   *         uploader:
   *           $ref: '#/components/schemas/UserSummary'
   *         report:
   *           $ref: '#/components/schemas/HSEReportSummary'
   *           nullable: true
   *         createdAt:
   *           type: string
   *           format: date-time
   *         updatedAt:
   *           type: string
   *           format: date-time
   */

  /**
   * @swagger
   * /api/hse/documents:
   *   post:
   *     summary: Upload a new HSE document
   *     description: |
   *       Creates a standalone HSE document. Can be linked to a report later via `reportId` or `update`.
   *       Use this when uploading files **without** creating a report.
   *     tags: [HSE Documents]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - firebaseUrls
   *               - type
   *               - size
   *             properties:
   *               name:
   *                 type: string
   *                 example: "Safety Incident Photo"
   *               firebaseUrls:
   *                 type: array
   *                 items:
   *                   type: string
   *                 example: ["https://storage.googleapis.com/.../photo1.jpg"]
   *               type:
   *                 type: string
   *                 example: "image/jpeg"
   *               size:
   *                 type: integer
   *                 example: 245000
   *               reportId:
   *                 type: integer
   *                 nullable: true
   *                 example: 4
   *                 description: Optional. Link to existing HSE report
   *     responses:
   *       201:
   *         description: Document created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HseDocument'
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error:
   *                   type: string
   *                   example: "Missing required fields"
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post("/", verifyToken,upload, uploadToFirebase, hseDocumentController.createDocument);

  /**
   * @swagger
   * /api/hse/documents:
   *   get:
   *     summary: Get all HSE documents
   *     description: |
   *       Retrieve paginated list of documents with optional filters.
   *       - Use `reportId=null` to get **unattached** documents
   *       - Use `reportId=5` to get **documents for report #5**
   *     tags: [HSE Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search by document name (partial match)
   *         example: "fire"
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *         description: Filter by MIME type
   *         example: "image/jpeg"
   *       - in: query
   *         name: reportId
   *         schema:
   *           type: string
   *         description: Filter by report ID. Use `null` for unattached.
   *         example: "null"
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         description: Filter by upload date (inclusive)
   *         example: "2025-11-01"
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date
   *         description: Filter by upload date (inclusive)
   *         example: "2025-11-03"
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         example: 20
   *     responses:
   *       200:
   *         description: Paginated list of documents
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 documents:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/HseDocument'
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     totalItems:
   *                       type: integer
   *                     currentPage:
   *                       type: integer
   *                     totalPages:
   *                       type: integer
   *                     itemsPerPage:
   *                       type: integer
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get("/", verifyToken, hseDocumentController.getAllDocuments);

  /**
   * @swagger
   * /api/hse/documents/{id}:
   *   get:
   *     summary: Get a single HSE document
   *     description: Retrieve full details of a document including uploader and linked report.
   *     tags: [HSE Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 5
   *         description: Document ID
   *     responses:
   *       200:
   *         description: Document retrieved
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HseDocument'
   *       404:
   *         description: Document not found
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get("/:id", verifyToken, hseDocumentController.getDocumentById);

  /**
   * @swagger
   * /api/hse/documents/{id}:
   *   put:
   *     summary: Update an HSE document
   *     description: |
   *       Update metadata, URLs, or link to a different report.
   *       - Use `reportId: null` to **detach** from current report
   *       - Use `reportId: 10` to **attach** to a new report
   *     tags: [HSE Documents]
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
   *               name:
   *                 type: string
   *                 example: "Updated Incident Screenshot"
   *               firebaseUrls:
   *                 type: array
   *                 items:
   *                   type: string
   *                 example: ["https://storage.googleapis.com/.../newphoto.png"]
   *               type:
   *                 type: string
   *                 example: "image/png"
   *               size:
   *                 type: integer
   *                 example: 312000
   *               reportId:
   *                 type: integer
   *                 nullable: true
   *                 example: 10
   *                 description: Change or remove report link
   *     responses:
   *       200:
   *         description: Document updated
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HseDocument'
   *       404:
   *         description: Document not found
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.put("/:id", verifyToken, hseDocumentController.updateDocument);

  /**
   * @swagger
   * /api/hse/documents/{id}:
   *   delete:
   *     summary: Delete an HSE document
   *     description: Permanently removes the document. Does **not** affect linked reports.
   *     tags: [HSE Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         example: 8
   *     responses:
   *       200:
   *         description: Document deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                   example: "Document deleted successfully"
   *       404:
   *         description: Document not found
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.delete("/:id", verifyToken, hseDocumentController.deleteDocument);

  app.use("/api/hse/documents", router);
};
