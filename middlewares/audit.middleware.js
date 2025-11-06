// middlewares/audit.middleware.js
const { Audit } = require("../models");
const { Op } = require("sequelize");

const auditActions = async (req, res, next) => {
  const originalSend = res.json;

  res.json = function (data) {
    const responseData = data;

    if (res.statusCode >= 200 && res.statusCode < 300) {
      const method = req.method;
      const fullPath = req.baseUrl + (req.route?.path || ""); // FULL PATH
      const userId = req.user?.id || null;
      const ip = req.ip || req.connection.remoteAddress;
      const ua = req.get("User-Agent") || "unknown";

      let action = null;
      let model = null;
      let recordId = null;
      let oldValues = null;
      let newValues = null;

      // === 1. CUSTOM ACTION (LOGIN, etc.) ===
      if (req.body && req.body._auditAction) {
        action = req.body._auditAction;
        model = req.body._auditModel || "User";
        recordId = req.body._auditRecordId || userId;
        newValues = responseData;
      }
      // === 2. ROUTE MAPPING USING FULL PATH ===
      else {
        const routeMap = {
          "/api/hse-reports": "HSEReport",
          "/api/documents": "Document",
          "/api/clients": "Client",
          "/api/projects": "Project",
          "/api/users": "User",
          "/api/hse/documents": "HseDocument",
          "/api/leaves": "Leave",
          "/api/logs": "Log",
          "/api/messaging": "Messaging",
          "/api/reports": "Report",
          "/api/roles": "Role",
          "/api/tasks": "Task",
          "/api/teams": "Team",
          "/api/work-logs": "WorkLog",
          "/api/auth": "Auth",
        };

        const matched = Object.keys(routeMap).find(base =>
          fullPath.startsWith(base) || fullPath.startsWith(base + "/")
        );

        if (matched) {
          model = routeMap[matched];

          if (method === "POST") {
            action = "CREATE";
            recordId = responseData?.report?.id || responseData?.id;
            newValues = responseData;
          }
          if (method === "PUT" || method === "PATCH") {
            action = "UPDATE";
            recordId = req.params.id || req.params.reportId;
            oldValues = req.body?._previousData;
            newValues = responseData;
          }
          if (method === "DELETE") {
            action = "DELETE";
            recordId = req.params.id;
            oldValues = req.body?._deletedData;
          }
        }
      }

      // === 3. LOGIN FALLBACK ===
      if (!action && req.originalUrl === "/api/auth/login") {
        action = "LOGIN";
        model = "User";
        recordId = userId;
      }

      // === 4. LOG AUDIT ===
      if (action && model) {
        console.log("AUDIT →", { action, model, recordId, userId }); // DEBUG

        Audit.create({
          userId,
          action,
          model,
          recordId,
          oldValues: oldValues ? JSON.stringify(oldValues) : null,
          newValues: newValues ? JSON.stringify(newValues) : null,
          ipAddress: ip,
          userAgent: ua,
        }).catch(err => console.error("Audit save failed:", err));
      }
    }

    return originalSend.call(this, responseData);
  };

  next();
};

module.exports = { auditActions };
