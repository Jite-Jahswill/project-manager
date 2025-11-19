// routes/hseReports.routes.js
const express = require("express");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const { getHseAnalytics } = require("../controllers/hseReports.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: HSE Reports & Analytics
   *     description: Real-time HSE performance dashboard data – one API powers the entire page
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *
   *   schemas:
   *     HseAnalyticsResponse:
   *       type: object
   *       properties:
   *         success:
   *           type: boolean
   *           example: true
   *         data:
   *           type: object
   *           properties:
   *             incidents:
   *               type: object
   *               properties:
   *                 total: { type: integer, example: 145 }
   *                 open: { type: integer, example: 23 }
   *                 pending: { type: integer, example: 18 }
   *                 closed: { type: integer, example: 104 }
   *             risks:
   *               type: object
   *               properties:
   *                 highRiskCount: { type: integer, example: 8 }
   *                 topHazards:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       hazard: { type: string, example: "Slip and Fall" }
   *                       count: { type: integer, example: 12 }
   *             training:
   *               type: object
   *               properties:
   *                 total: { type: integer, example: 42 }
   *                 completed: { type: integer, example: 35 }
   *                 compliancePercentage: { type: integer, example: 83 }
   *                 overdue: { type: integer, example: 5 }
   *             audits:
   *               type: object
   *               properties:
   *                 upcomingThisWeek: { type: integer, example: 3 }
   *             trends:
   *               type: object
   *               properties:
   *                 monthlyIncidents:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       month: { type: string, example: "2025-06" }
   *                       incidents: { type: integer, example: 18 }
   *         generatedAt:
   *           type: string
   *           format: date-time
   *           example: "2025-07-19T10:30:00.000Z"
   *
   * /api/hse/reports/analytics:
   *   get:
   *     summary: Get complete HSE analytics (single source of truth for HSE dashboard)
   *     description: Returns all key HSE metrics – incidents, risks, training compliance, upcoming audits, trends
   *     tags: [HSE Reports & Analytics]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Full HSE analytics data
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HseAnalyticsResponse'
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden – missing hse:reports:view permission
   *       500:
   *         description: Server error
   */

  router.get(
    "/analytics",
    verifyToken,
    hasPermission("hse:reports:view"),
    getHseAnalytics
  );

  app.use("/api/hse/reports", router);
};
