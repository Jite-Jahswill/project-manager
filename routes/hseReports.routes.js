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
   *     description: Real-time HSE performance dashboard data
   *
   * /api/hse/reports/analytics:
   *   get:
   *     summary: Get full HSE analytics dashboard data (one API for entire page)
   *     tags: [HSE Reports & Analytics]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200:
   *         description: Complete HSE analytics
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean }
   *                 data:
   *                   type: object
   *                   properties:
   *                     incidents: { type: object, properties: { total: integer, open: integer, pending: integer, closed: integer } }
   *                     risks: { type: object, properties: { highRiskCount: integer, topHazards: array } }
   *                     training: { type: object, properties: { compliancePercentage: integer, overdue: integer } }
   *                     audits: { type: object, properties: { upcomingThisWeek: integer } }
   *                     trends: { type: object, properties: { monthlyIncidents: array } }
   *                 generatedAt: { type: string, format: date-time }
   */

  router.get("/analytics", verifyToken, hasPermission("hse:reports:view"), getHseAnalytics);

  app.use("/api/hse/reports", router);
};
