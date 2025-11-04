const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const hseDocumentController = require("../controllers/hseDocument.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   name: HSE Documents
   *   description: Manage uploaded HSE files and attachments
   */

  /**
   * @swagger
   * /api/hse/documents:
   *   post:
   *     summary: Upload a new HSE document
   *     description: Creates a new HSE document record and optionally links it to an HSE report.
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
   *                 example: "Safety Report Photo"
   *               firebaseUrls:
   *                 type: array
   *                 items:
   *                   type: string
   *                   example: "https://firebase.storage/doc1.jpg"
   *               reportId:
   *                 type: integer
   *                 example: 4
   *               type:
   *                 type: string
   *                 example: "image/jpeg"
   *               size:
   *                 type: integer
   *                 example: 245000
   *     responses:
   *       201:
   *         description: Document uploaded successfully
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post("/", verifyToken, hseDocumentController.createDocument);

  /**
   * @swagger
   * /api/hse/documents:
   *   get:
   *     summary: Get all HSE documents
   *     description: Fetches all HSE documents, with optional search, filter, and date range.
   *     tags: [HSE Documents]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         example: "fire"
   *         description: Search documents by name
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *         example: "image/jpeg"
   *       - in: query
   *         name: reportId
   *         schema:
   *           type: integer
   *         example: 2
   *       - in: query
   *         name: startDate
   *         schema:
   *           type: string
   *           format: date
   *         example: "2025-11-01"
   *       - in: query
   *         name: endDate
   *         schema:
   *           type: string
   *           format: date
   *         example: "2025-11-03"
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *         example: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         example: 20
   *     responses:
   *       200:
   *         description: List of HSE documents with pagination
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
   *     description: Fetches details of a specific HSE document by ID.
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
   *         description: ID of the HSE document
   *     responses:
   *       200:
   *         description: Document details retrieved successfully
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Document not found
   *       500:
   *         description: Server error
   */
  router.get("/:id", verifyToken, hseDocumentController.getDocumentById);

  /**
   * @swagger
   * /api/hse/documents/{id}:
   *   put:
   *     summary: Update an HSE document
   *     description: Updates metadata or Firebase URLs of an existing document.
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
   *                   example: "https://firebase.storage/newphoto.png"
   *               type:
   *                 type: string
   *                 example: "image/png"
   *               size:
   *                 type: integer
   *                 example: 312000
   *     responses:
   *       200:
   *         description: Document updated successfully
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Document not found
   *       500:
   *         description: Server error
   */
  router.put("/:id", verifyToken, hseDocumentController.updateDocument);

  /**
   * @swagger
   * /api/hse/documents/{id}:
   *   delete:
   *     summary: Delete an HSE document
   *     description: Permanently deletes a document from the system.
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
   *         description: Document deleted successfully
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Document not found
   *       500:
   *         description: Server error
   */
  router.delete("/:id", verifyToken, hseDocumentController.deleteDocument);

  app.use("/api/hse/documents", router);
};
