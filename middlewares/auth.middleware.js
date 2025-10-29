const jwt = require("jsonwebtoken");
const { User, Role } = require("../models");

// 🔹 Verify Token Middleware
exports.verifyToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(403).json({ error: "No token provided" });

  try {
    const decoded = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// 🔹 SuperAdmin Only
exports.isSuperAdmin = (req, res, next) => {
  if (req.user.role !== "superadmin") {
    return res.status(403).json({ error: "SuperAdmin access required" });
  }
  next();
};

// 🔹 Customer Only
exports.isCustomer = (req, res, next) => {
  if (req.user.role !== "customer") {
    return res.status(403).json({ error: "Customer access required" });
  }
  next();
};

// 🔹 Permission-based Access
exports.hasPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const user = await User.findByPk(req.user.id, {
        include: [{ model: Role, as: "role" }],
      });

      if (!user) return res.status(401).json({ error: "Unauthorized" });

      // SuperAdmin always has access
      if (user.role?.name === "superadmin") return next();

      // Check permission from role
      const permissions = user.role?.permissions || [];
      if (!permissions.includes(requiredPermission)) {
        return res.status(403).json({ error: "Permission denied" });
      }

      next();
    } catch (err) {
      console.error("Permission middleware error:", err);
      res.status(500).json({ error: "Server error" });
    }
  };
};
