// routes/proposal.routes.js
const express = require("express");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const proposalController = require("../controllers/proposal.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Proposals
   *     description: Full proposal lifecycle – Draft → Submit → Approve/Reject → Won/Lost
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *
   * /api/proposals:
   *   post:
   *     summary: Create or update draft proposal
   *     tags: [Proposals]
   *     security: [bearerAuth: []]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [title, clientName, value, description, validUntil]
   *             properties:
   *               id: { type: integer }
   *               title: { type: string }
   *               clientName: { type: string }
   *               value: { type: number }
   *               description: { type: string }
   *               validUntil: { type: string, format: date }
   *     responses:
   *       201: { description: Created }
   *       200: { description: Draft updated }
   *
   *   get:
   *     summary: Get all proposals – FULLY SEARCHABLE
   *     tags: [Proposals]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *         description: Search in title, client, or proposal ID
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [Draft, Submitted, Under Review, Approved, Rejected, Won, Lost] }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200: { description: Paginated + searchable list }
   *
   * /api/proposals/{id}:
   *   get:
   *     summary: Get single proposal by ID
   *     tags: [Proposals]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *     responses:
   *       200: { description: Full proposal details }
   *
   *   delete:
   *     summary: Delete proposal (only Draft or Rejected)
   *     tags: [Proposals]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *     responses:
   *       200: { description: Deleted }
   *       403: { description: Cannot delete processed proposals }
   *
   * /api/proposals/{id}/submit:
   *   post:
   *     summary: Submit proposal for approval
   *     tags: [Proposals]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *     responses:
   *       200: { description: Submitted + email sent }
   *
   * /api/proposals/{id}/status:
   *   patch:
   *     summary: Update status (Approved/Rejected/Won/Lost) – Manager only
   *     tags: [Proposals]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
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
   *                 enum: [Approved, Rejected, Won, Lost]
   *     responses:
   *       200: { description: Status updated + notification sent }
   */

  router.post("/", verifyToken, hasPermission("proposals:create"), proposalController.createOrUpdateProposal);
  router.get("/", verifyToken, hasPermission("proposals:view"), proposalController.getAllProposals);
  router.get("/:id", verifyToken, hasPermission("proposals:view"), proposalController.getProposalById);
  router.post("/:id/submit", verifyToken, hasPermission("proposals:submit"), proposalController.submitProposal);
  router.patch("/:id/status", verifyToken, hasPermission("proposals:approve"), proposalController.updateProposalStatus);
  router.delete("/:id", verifyToken, hasPermission("proposals:create"), proposalController.deleteProposal); // Owner can delete drafts

  app.use("/api/proposals", router);
};
