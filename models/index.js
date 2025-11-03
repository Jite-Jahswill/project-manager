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
db.Conversation = require("./conversation.model")(sequelize, DataTypes);
db.Message = require("./message.model")(sequelize, DataTypes);
db.Participant = require("./participant.model")(sequelize, DataTypes);
db.HSEReport = require("./hseReport.model")(sequelize, DataTypes);

// Run model-defined associations (if any in .associate)
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// === ASSOCIATIONS ===

// Project ↔ Client
db.Project.belongsToMany(db.Client, {
  through: db.ClientProject,
  foreignKey: "projectId",
  otherKey: "clientId",
  as: "Clients",
});
db.Client.belongsToMany(db.Project, {
  through: db.ClientProject,
  foreignKey: "clientId",
  otherKey: "projectId",
  as: "Projects",
});

// User ↔ Team
db.User.belongsToMany(db.Team, {
  through: db.UserTeam,
  foreignKey: "userId",
  otherKey: "teamId",
});
db.Team.belongsToMany(db.User, {
  through: db.UserTeam,
  foreignKey: "teamId",
  otherKey: "userId",
});

// Project ↔ Team
db.Project.belongsToMany(db.Team, {
  through: db.TeamProject,
  foreignKey: "projectId",
  otherKey: "teamId",
  as: "Teams",
});
db.Team.belongsToMany(db.Project, {
  through: db.TeamProject,
  foreignKey: "teamId",
  otherKey: "projectId",
});

// === MESSAGING ASSOCIATIONS ===

// Conversation ↔ User (via Participant) — ONLY ONCE!
db.Conversation.belongsToMany(db.User, {
  through: db.Participant,
  foreignKey: "conversationId",
  otherKey: "userId",
  as: "participants",
});
db.User.belongsToMany(db.Conversation, {
  through: db.Participant,
  foreignKey: "userId",
  otherKey: "conversationId",
  as: "conversations",
});

// Participant → Conversation & User
db.Participant.belongsTo(db.Conversation, {
  foreignKey: "conversationId",
  onDelete: "CASCADE",
});
db.Participant.belongsTo(db.User, {
  foreignKey: "userId",
  onDelete: "CASCADE",
});

db.Conversation.hasMany(db.Participant, {
  foreignKey: "conversationId",
  onDelete: "CASCADE",
});
db.User.hasMany(db.Participant, {
  foreignKey: "userId",
  onDelete: "CASCADE",
});

// Conversation → Message
db.Conversation.hasMany(db.Message, {
  foreignKey: "conversationId",
  onDelete: "CASCADE",
});
db.Message.belongsTo(db.Conversation, {
  foreignKey: "conversationId",
});

// Message → User (sender)
db.Message.belongsTo(db.User, {
  as: "sender",
  foreignKey: "senderId",
});
db.User.hasMany(db.Message, {
  as: "messages",
  foreignKey: "senderId",
});

// === OTHER ASSOCIATIONS ===
db.Project.hasMany(db.Task, { foreignKey: "projectId", onDelete: "CASCADE" });
db.Task.belongsTo(db.Project, { foreignKey: "projectId" });

db.User.hasMany(db.Task, { foreignKey: "assignedTo" });
db.Task.belongsTo(db.User, { foreignKey: "assignedTo", as: "assignee" });

db.User.hasMany(db.WorkLog, { foreignKey: "userId" });
db.WorkLog.belongsTo(db.User, { foreignKey: "userId" });

db.Project.hasMany(db.WorkLog, { foreignKey: "projectId" });
db.WorkLog.belongsTo(db.Project, { foreignKey: "projectId" });

db.Task.hasMany(db.WorkLog, { foreignKey: "taskId" });
db.WorkLog.belongsTo(db.Task, { foreignKey: "taskId" });

db.User.hasMany(db.Leave, { foreignKey: "userId" });
db.Leave.belongsTo(db.User, { foreignKey: "userId" });

db.User.hasMany(db.Report, { foreignKey: "userId" });
db.Report.belongsTo(db.User, { foreignKey: "userId" });

db.Project.hasMany(db.Report, { foreignKey: "projectId" });
db.Report.belongsTo(db.Project, { foreignKey: "projectId" });

db.User.hasMany(db.HSEReport, { foreignKey: "reporterId", as: "hseReports" });

// === END ===
module.exports = db;
