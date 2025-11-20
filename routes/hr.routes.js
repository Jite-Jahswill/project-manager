// routes/hr.routes.js
const express = require("express");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");
const hrController = require("../controllers/hr.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: HR & Employee Management
   *     description: Full employee lifecycle – onboarding, approvals, training tracking
   *
   * /api/hr/dashboard:
   *   get:
   *     summary: HR Dashboard KPIs
   *     tags: [HR & Employee Management]
   *     security: [bearerAuth: []]
   *
   * /api/hr/employees:
   *   post:
   *     summary: Create new employee (pending approval)
   *     tags: [HR & Employee Management]
   *     security: [bearerAuth: []]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [firstName, lastName, email, department, position]
   *             properties:
   *               firstName: { type: string }
   *               lastName: { type: string }
   *               email: { type: string }
   *               department: { type: string, enum: [Operations, IT, Finance, HR, Sales, Marketing, Executive] }
   *               position: { type: string }
   *               hireDate: { type: string, format: date }
   *
   *   get:
   *     summary: List all employees – fully searchable
   *     tags: [HR & Employee Management]
   *     security: [bearerAuth: []]
   *
   * /api/hr/employees/{id}:
   *   put:
   *     summary: Update employee details
   *     tags: [HR & Employee Management]
   *     security: [bearerAuth: []]
   *
   *   delete:
   *     summary: Delete employee (only Pending or Terminated)
   *     tags: [HR & Employee Management]
   *     security: [bearerAuth: []]
   *
   * /api/hr/employees/{id}/approve:
   *   post:
   *     summary: Approve new hire
   *     tags: [HR & Employee Management]
   *     security: [bearerAuth: []]
   */

  router.get("/dashboard", verifyToken, hasPermission("hr:dashboard"), hrController.getHrDashboard);

  router.post("/employees", verifyToken, hasPermission("hr:manage"), hrController.createEmployee);
  router.get("/employees", verifyToken, hasPermission("hr:view"), hrController.getAllEmployees);
  router.put("/employees/:id", verifyToken, hasPermission("hr:manage"), hrController.updateEmployee);
  router.delete("/employees/:id", verifyToken, hasPermission("hr:manage"), hrController.deleteEmployee);
  router.post("/employees/:id/approve", verifyToken, hasPermission("hr:approve"), hrController.approveHire);

  app.use("/api/hr", router);
};
