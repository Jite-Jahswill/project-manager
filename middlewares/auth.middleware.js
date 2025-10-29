const jwt = require("jsonwebtoken");

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
  return (req, res, next) => {
    // SuperAdmin always has access
    if (req.user.role === "superadmin") return next();

    // Ensure permission exists
    if (!req.user.permissions || !req.user.permissions.includes(requiredPermission)) {
      return res.status(403).json({ error: "Permission denied" });
    }

    next();
  };
};
