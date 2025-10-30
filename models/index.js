// models/index.js
const { Sequelize, DataTypes } = require("sequelize");
const sequelize = require("../config/db.config");

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

// Import models
db.User = require("./user.model")(sequelize, DataTypes);
db.Project = require("./project.model")(sequelize, DataTypes);
db.UserTeam = require("./userTeam.model")(sequelize, DataTypes);
db.Task = require("./task.model")(sequelize, DataTypes);
db.WorkLog = require("./worklog.model")(sequelize, DataTypes);
db.Leave = require("./leave.model")(sequelize, DataTypes);
db.Report = require("./report.model")(sequelize, DataTypes);
db.Team = require("./team.model")(sequelize, DataTypes);
db.Client = require("./client.model")(sequelize, DataTypes);
db.ClientProject = require("./clientProject.model")(sequelize, DataTypes);
db.TeamProject = require("./teamProject.model")(sequelize, DataTypes);
db.Role = require("./role.model")(sequelize, DataTypes);
db.Permission = require("./permission.model")(sequelize, DataTypes);
db.RolePermission = require("./rolePermission.model")(sequelize, DataTypes);
db.UserRole = require("./userRole.model")(sequelize, DataTypes);
db.Document = require("./document.model")(sequelize, DataTypes);

// ========================================
// ALL ASSOCIATIONS — CENTRALIZED HERE
// ========================================

// Client ↔ Project (Many-to-Many)
db.Project.belongsToMany(db.Client, {
  through: db.ClientProject,
  foreignKey: "projectId",
  otherKey: "clientId",
  as: "Clients"
});
db.Client.belongsToMany(db.Project, {
  through: db.ClientProject,
  foreignKey: "clientId",
  otherKey: "projectId",
  as: "Projects"
});

// Project ↔ Team (Many-to-Many)
db.Project.belongsToMany(db.Team, {
  through: db.TeamProject,
  foreignKey: "projectId",
  otherKey: "teamId",
  as: "Teams"
});
db.Team.belongsToMany(db.Project, {
  through: db.TeamProject,
  foreignKey: "teamId",
  otherKey: "projectId",
  as: "Projects"
});

// User ↔ Team (Many-to-Many)
db.User.belongsToMany(db.Team, {
  through: db.UserTeam,
  foreignKey: "userId",
  otherKey: "teamId",
  as: "Teams"
});
db.Team.belongsToMany(db.User, {
  through: db.UserTeam,
  foreignKey: "teamId",
  otherKey: "userId",
  as: "Members"
});

// Project → Task (One-to-Many)
db.Project.hasMany(db.Task, {
  foreignKey: "projectId",
  as: "Tasks",
  onDelete: "CASCADE"
});
db.Task.belongsTo(db.Project, { foreignKey: "projectId" });

// User → Task (One-to-Many)
db.User.hasMany(db.Task, {
  foreignKey: "assignedTo",
  as: "AssignedTasks"
});
db.Task.belongsTo(db.User, {
  foreignKey: "assignedTo",
  as: "Assignee"
});

// WorkLog
db.User.hasMany(db.WorkLog, { foreignKey: "userId", as: "WorkLogs" });
db.WorkLog.belongsTo(db.User, { foreignKey: "userId" });

db.Project.hasMany(db.WorkLog, { foreignKey: "projectId", as: "WorkLogs" });
db.WorkLog.belongsTo(db.Project, { foreignKey: "projectId" });

db.Task.hasMany(db.WorkLog, { foreignKey: "taskId", as: "WorkLogs" });
db.WorkLog.belongsTo(db.Task, { foreignKey: "taskId" });

// Leave
db.User.hasMany(db.Leave, { foreignKey: "userId", as: "Leaves" });
db.Leave.belongsTo(db.User, { foreignKey: "userId" });

// Report
db.User.hasMany(db.Report, { foreignKey: "userId", as: "Reports" });
db.Report.belongsTo(db.User, { foreignKey: "userId" });

db.Project.hasMany(db.Report, { foreignKey: "projectId", as: "Reports" });
db.Report.belongsTo(db.Project, { foreignKey: "projectId" });

// Document
db.Project.hasMany(db.Document, { foreignKey: "projectId", as: "Documents" });
db.Document.belongsTo(db.Project, { foreignKey: "projectId" });

// Role & Permissions (if using)
db.Role.belongsToMany(db.Permission, { through: db.RolePermission, foreignKey: "roleId" });
db.Permission.belongsToMany(db.Role, { through: db.RolePermission, foreignKey: "permissionId" });

db.User.belongsTo(db.Role, { foreignKey: "roleId", as: "Role" });

module.exports = db;
