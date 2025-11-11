const express = require("express");
const reportController = require("../controllers/report.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const { upload, uploadToFirebase } = require("../middlewares/upload.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Reports
   *     description: Project incident and safety reporting with file attachments
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
   *     ProjectSummary:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 1 }
   *         name: { type: string, example: "Site Construction" }
   *
   *     TeamSummary:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 1 }
   *         name: { type: string, example: "Safety Team" }
   *
   *     DocumentSummary:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 5 }
   *         name: { type: string, example: "Incident Photo.jpg" }
   *         firebaseUrl: { type: string, example: "https://storage.../photo1.jpg" }
   *         type: { type: string, example: "image/jpeg" }
   *         size: { type: integer, example: 245000 }
   *         status: { type: string, enum: [pending, approved, rejected, completed, "not complete"], example: "pending" }
   *         uploadedBy: { type: integer, example: 1 }
   *         createdAt: { type: string, format: date-time }
   *         uploader:
   *           $ref: '#/components/schemas/UserSummary'
   *
   *     Report:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 1 }
   *         title: { type: string, example: "Near Miss - Slip Hazard" }
   *         dateOfReport: { type: string, format: date, example: "2025-11-04" }
   *         timeOfReport: { type: string, format: time, example: "14:30:00" }
   *         reporter: { $ref: '#/components/schemas/UserSummary' }
   *         report: { type: string, description: "Detailed incident description" }
   *         status: { type: string, enum: [open, pending, closed], default: open, example: "open" }
   *         closedAt: { type: string, format: date-time, nullable: true }
   *         closer: { $ref: '#/components/schemas/UserSummary', nullable: true }
   *         project: { $ref: '#/components/schemas/ProjectSummary', nullable: true }
   *         team: { $ref: '#/components/schemas/TeamSummary', nullable: true }
   *         documents:
   *           type: array
   *           items: { $ref: '#/components/schemas/DocumentSummary' }
   *           description: All files attached to this report
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   */

  /**
   * @swagger
   * /api/reports:
   *   post:
   *     summary: Create a new project report
   *     description: |
   *       Creates a report with optional file uploads and/or linking existing documents via `attachedDocIds`.
   *       Files are uploaded via `files[]` field.
   *     tags: [Reports]
   *     security: [bearerAuth: []]
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
   *               title: { type: string, example: "Slip Hazard" }
   *               dateOfReport: { type: string, format: date, example: "2025-11-04" }
   *               timeOfReport: { type: string, format: time, example: "14:30:00" }
   *               report: { type: string, example: "Worker slipped on wet floor..." }
   *               projectId: { type: integer, example: 1, nullable: true }
   *               teamId: { type: integer, example: 1, nullable: true }
   *               attachedDocIds:
   *                 type: array
   *                 items: { type: integer }
   *                 description: List of existing document IDs to attach
   *                 example: [5, 7]
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Upload new files
   *     responses:
   *       201:
   *         description: Report created
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string }
   *                 report: { $ref: '#/components/schemas/Report' }
   *       400: { description: Missing required fields or invalid document IDs }
   *       404: { description: Project/Team not found }
   *       500: { description: Server error }
   */
  router.post(
    "/",
    verifyToken,
    hasPermission("report:create"),
    upload.array("files", 10),           // Accept up to 10 files
    uploadToFirebase,
    reportController.createReport
  );

  /**
   * @swagger
   * /api/reports:
   *   get:
   *     summary: List all reports
   *     tags: [Reports]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: query
   *         name: projectId
   *         schema: { type: integer }
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [open, pending, closed] }
   *       - in: query
   *         name: reporterName
   *         schema: { type: string }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200:
   *         description: Paginated reports
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 reports:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/Report' }
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     currentPage: { type: integer }
   *                     totalPages: { type: integer }
   *                     totalItems: { type: integer }
   *                     itemsPerPage: { type: integer }
   */
  router.get(
    "/",
    verifyToken,
    hasPermission("report:read"),
    reportController.getAllReports
  );

  /**
   * @swagger
   * /api/reports/{id}:
   *   get:
   *     summary: Get report by ID
   *     tags: [Reports]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200:
   *         description: Full report with documents
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 report: { $ref: '#/components/schemas/Report' }
   *       404: { description: Report not found }
   */
  router.get(
    "/:id",
    verifyToken,
    hasPermission("report:read"),
    reportController.getReportById
  );

  /**
   * @swagger
   * /api/reports/{id}:
   *   put:
   *     summary: Update report
   *     description: |
   *       Update text, status, or add new files. Also supports:
   *       - `attachedDocIds`: Link existing documents
   *       - `detachDocIds`: Unlink documents
   *     tags: [Reports]
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
   *               title: { type: string }
   *               dateOfReport: { type: string, format: date }
   *               timeOfReport: { type: string, format: time }
   *               report: { type: string }
   *               status: { type: string, enum: [open, pending, closed] }
   *               closedBy: { type: integer }
   *               attachedDocIds:
   *                 type: array
   *                 items: { type: integer }
   *                 example: [8, 9]
   *               detachDocIds:
   *                 type: array
   *                 items: { type: integer }
   *                 example: [5]
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *     responses:
   *       200:
   *         description: Report updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string }
   *                 report: { $ref: '#/components/schemas/Report' }
   */
  router.put(
    "/:id",
    verifyToken,
    hasPermission("report:update"),
    upload.array("files", 10),
    uploadToFirebase,
    reportController.updateReport
  );

  /**
   * @swagger
   * /api/reports/{id}:
   *   delete:
   *     summary: Delete report
   *     description: Deletes report and unlinks documents (files remain in Firebase).
   *     tags: [Reports]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Report deleted }
   */
  router.delete(
    "/:id",
    verifyToken,
    hasPermission("report:delete"),
    reportController.deleteReport
  );

  /**
   * @swagger
   * /api/reports/{id}/close:
   *   patch:
   *     summary: Close report
   *     tags: [Reports]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200:
   *         description: Report closed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string }
   *                 report: { $ref: '#/components/schemas/Report' }
   */
  router.patch(
    "/:id/close",
    verifyToken,
    hasPermission("report:update"),
    reportController.closeReport
  );

  app.use("/api/reports", router);
};
