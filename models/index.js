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

// Run model-specific associations
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// ========= Associations ========= //

// Clients ↔ Projects
db.Project.belongsToMany(db.Client, {
  through: db.ClientProject,
  foreignKey: "projectId",
  otherKey: "clientId",
  as: "clients",
});
db.Client.belongsToMany(db.Project, {
  through: db.ClientProject,
  foreignKey: "clientId",
  otherKey: "projectId",
  as: "projects",
});

// Users ↔ Teams
db.User.belongsToMany(db.Team, {
  through: db.UserTeam,
  foreignKey: "userId",
  otherKey: "teamId",
  as: "teams",
});
db.Team.belongsToMany(db.User, {
  through: db.UserTeam,
  foreignKey: "teamId",
  otherKey: "userId",
  as: "members",
});

// Teams ↔ Projects
db.Project.belongsToMany(db.Team, {
  through: db.TeamProject,
  foreignKey: "projectId",
  otherKey: "teamId",
  as: "teams",
});
db.Team.belongsToMany(db.Project, {
  through: db.TeamProject,
  foreignKey: "teamId",
  otherKey: "projectId",
  as: "projects",
});

// Project → Tasks
db.Project.hasMany(db.Task, { foreignKey: "projectId", onDelete: "CASCADE", as: "tasks" });
// db.Task.belongsTo(db.Project, { foreignKey: "projectId", onDelete: "CASCADE", as: "project" });

// Task → Assignee (User)
// db.Task.belongsTo(db.User, { foreignKey: "assignedTo", as: "assignee", onDelete: "SET NULL" });
db.User.hasMany(db.Task, { foreignKey: "assignedTo", as: "tasks", onDelete: "SET NULL" });

// WorkLogs
db.User.hasMany(db.WorkLog, { foreignKey: "userId", as: "worklogs" });
db.WorkLog.belongsTo(db.User, { foreignKey: "userId", as: "user" });

db.Project.hasMany(db.WorkLog, { foreignKey: "projectId", as: "worklogs" });
db.WorkLog.belongsTo(db.Project, { foreignKey: "projectId", as: "project" });

db.Task.hasMany(db.WorkLog, { foreignKey: "taskId", as: "worklogs" });
db.WorkLog.belongsTo(db.Task, { foreignKey: "taskId", as: "task" });

// Leave
db.User.hasMany(db.Leave, { foreignKey: "userId", as: "leaves" });
db.Leave.belongsTo(db.User, { foreignKey: "userId", as: "user" });

// Reports
db.User.hasMany(db.Report, { foreignKey: "userId", as: "reports" });
db.Report.belongsTo(db.User, { foreignKey: "userId", as: "user" });

db.Project.hasMany(db.Report, { foreignKey: "projectId", as: "reports" });
db.Report.belongsTo(db.Project, { foreignKey: "projectId", as: "project" });

// Optional: Team → Projects
db.Team.hasMany(db.Project, { foreignKey: "teamId", onDelete: "CASCADE", as: "ownedProjects" });
db.Project.belongsTo(db.Team, { foreignKey: "teamId", as: "team" });

// Optional: Client → Projects
db.Client.hasMany(db.Project, { foreignKey: "clientId", as: "ownedProjects" });
db.Project.belongsTo(db.Client, { foreignKey: "clientId", as: "client" });

module.exports = db;
