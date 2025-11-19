module.exports = (sequelize, DataTypes) => in {
  const AuditAssignment = sequelize.define("AuditAssignment", {}, { tableName: "AuditAssignments", timestamps: false });
  return AuditAssignment;
};
