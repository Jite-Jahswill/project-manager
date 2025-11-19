// routes/finance.routes.js
const express = require("express");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const financeController = require("../controllers/finance.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Finance Module
   *     description: Budget control, expense submission & approval workflow
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *
   * /api/finance/dashboard:
   *   get:
   *     summary: Finance Dashboard KPIs
   *     tags: [Finance Module]
   *     security: [bearerAuth: []]
   *     responses:
   *       200: { description: All finance KPIs }
   *
   * /api/finance/expenses:
   *   post:
   *     summary: Submit new payment/expense request
   *     tags: [Finance Module]
   *     security: [bearerAuth: []]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [vendor, amount, category, expenseDate, description]
   *             properties:
   *               vendor: { type: string }
   *               amount: { type: number }
   *               category: { type: string, enum: [Operations, IT Infrastructure, Marketing, Human Resources, Travel, Office Supplies, Professional Services, Utilities] }
   *               expenseDate: { type: string, format: date }
   *               description: { type: string }
   *     responses:
   *       201: { description: Request submitted }
   *
   * /api/finance/expenses/pending:
   *   get:
   *     summary: Get all pending approvals
   *     tags: [Finance Module]
   *     security: [bearerAuth: []]
   *     responses:
   *       200: { description: List of pending requests }
   *
   * /api/finance/expenses/{id}/approve:
   *   post:
   *     summary: Approve expense (Finance only)
   *     tags: [Finance Module]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *     responses:
   *       200: { description: Approved + email sent }
   *
   * /api/finance/expenses/{id}/reject:
   *   post:
   *     summary: Reject expense
   *     tags: [Finance Module]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reason: { type: string }
   *     responses:
   *       200: { description: Rejected + email sent }
   */

  router.get("/dashboard", verifyToken, hasPermission("finance:dashboard"), financeController.getFinanceDashboard);
  router.post("/expenses", verifyToken, hasPermission("finance:submit"), financeController.submitExpense);
  router.get("/expenses/pending", verifyToken, hasPermission("finance:approve"), financeController.getPendingApprovals);
  router.post("/expenses/:id/approve", verifyToken, hasPermission("finance:approve"), financeController.approveExpense);
  router.post("/expenses/:id/reject", verifyToken, hasPermission("finance:approve"), financeController.rejectExpense);

  app.use("/api/finance", router);
};
