// middlewares/audit.middleware.js
const { Audit } = require("../models");
const { Op } = require("sequelize");

const auditActions = async (req, res, next) => {
  const originalSend = res.json;

  res.json = function (data) {
    // Capture response
    const responseData = data;

    // Only log on success (2xx)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const route = req.route?.path;
      const method = req.method;
      const userId = req.user?.id || null;
      const ip = req.ip || req.connection.remoteAddress;
      const ua = req.get("User-Agent");

      let action, model, recordId, oldValues, newValues;

      // === MAP ROUTES TO MODELS ===
      const routeToModel = {
        "/api/reports": "Report",
        "/api/documents": "Document",
        "/api/clients": "Client",
        "/api/projects": "Project",
        "/api/teams": "Team",
        "/api/tasks": "Task",
        "/api/leaves": "Leave",
        "/api/hse/reports": "HSEReport",
        "/api/hse/documents": "HseDocument",
        "/api/users": "User",
        "/api/roles": "Role",
      };

      const basePath = Object.keys(routeToModel).find((path) =>
        route?.startsWith(path.replace(":id", "").replace("*", ""))
      );

      if (basePath) {
        model = routeToModel[basePath];

        if (method === "POST") {
          action = "CREATE";
          recordId = responseData?.report?.id || responseData?.document?.id || responseData?.id;
          newValues = responseData?.report || responseData?.document || responseData;
        }

        if (method === "PUT" || method === "PATCH") {
          action = "UPDATE";
          recordId = req.params.id || req.params.documentId || req.params.reportId;
          oldValues = req.body._previousData; // Set by controller
          newValues = responseData?.report || responseData?.document || responseData;
        }

        if (method === "DELETE") {
          action = "DELETE";
          recordId = req.params.id || req.params.documentId;
          oldValues = req.body._deletedData; // Set by controller
        }
      }

      // === LOGIN / LOGOUT (via auth routes) ===
      if (route === "/api/auth/login") action = "LOGIN";
      if (route === "/api/auth/logout") action = "LOGOUT";

      if (action && model) {
        Audit.create({
          userId,
          action,
          model,
          recordId,
          oldValues: oldValues ? JSON.stringify(oldValues) : null,
          newValues: newValues ? JSON.stringify(newValues) : null,
          ipAddress: ip,
          userAgent: ua,
        }).catch((err) => console.error("Audit log failed:", err));
      }
    }

    return originalSend.call(this, responseData);
  };

  next();
};

module.exports = { auditActions };
