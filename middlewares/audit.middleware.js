// middlewares/audit.middleware.js
const { Audit } = require("../models");

const auditActions = async (req, res, next) => {
  const originalSend = res.json;

  res.json = function (data) {
    const responseData = data;

    // Only log on success (2xx)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const route = req.route?.path;
      const method = req.method;
      const userId = req.user?.id || null;
      const ip = req.ip || req.connection.remoteAddress;
      const ua = req.get("User-Agent");

      let action = null;
      let model = null;
      let recordId = null;
      let oldValues = null;
      let newValues = null;

      // === 1. CUSTOM OVERRIDE (e.g. LOGIN) — SAFE CHECK ===
      if (req.body && typeof req.body === 'object' && req.body._auditAction) {
        action = req.body._auditAction;
        model = req.body._auditModel || "User";
        recordId = req.body._auditRecordId || userId;
        newValues = responseData;
      }
      // === 2. ROUTE-BASED MAPPING (CRUD) ===
      else {
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
          route?.startsWith(path.replace(/:\w+/g, "").replace("*", ""))
        );

        if (basePath) {
          model = routeToModel[basePath];

          if (method === "POST") {
            action = "CREATE";
            recordId = responseData?.report?.id || responseData?.document?.id || responseData?.id || responseData?.user?.id;
            newValues = responseData?.report || responseData?.document || responseData?.user || responseData;
          }

          if (method === "PUT" || method === "PATCH") {
            action = "UPDATE";
            recordId = req.params.id || req.params.documentId || req.params.reportId || req.params.userId;
            oldValues = req.body?._previousData;
            newValues = responseData?.report || responseData?.document || responseData?.user || responseData;
          }

          if (method === "DELETE") {
            action = "DELETE";
            recordId = req.params.id || req.params.documentId || req.params.userId;
            oldValues = req.body?._deletedData;
          }
        }
      }

      // === 3. FALLBACK: LOGIN/LOGOUT ===
      if (!action && route) {
        if (route === "/api/auth/login") action = "LOGIN";
        if (route === "/api/auth/logout") action = "LOGOUT";
        if (action) {
          model = "User";
          recordId = userId;
        }
      }

      // === 4. LOG TO DB (only if valid) ===
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
