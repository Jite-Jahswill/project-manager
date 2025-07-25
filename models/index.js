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

// Run associations
Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Define associations
db.Project.belongsToMany(db.Client, {
  through: db.ClientProject,
  foreignKey: "projectId",
  otherKey: "clientId",
});
db.Client.belongsToMany(db.Project, {
  through: db.ClientProject,
  foreignKey: "clientId",
  otherKey: "projectId",
});

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

db.Project.belongsToMany(db.Team, {
  through: db.TeamProject,
  foreignKey: "projectId",
  otherKey: "teamId",
});
db.Team.belongsToMany(db.Project, {
  through: db.TeamProject,
  foreignKey: "teamId",
  otherKey: "projectId",
});

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

db.Client.hasMany(db.Project, { foreignKey: "clientId" });
db.Project.belongsTo(db.Client, { foreignKey: "clientId" });

module.exports = db;


// const { Sequelize, DataTypes } = require("sequelize");
// const sequelize = require("../config/db.config");

// const db = {};

// db.Sequelize = Sequelize;
// db.sequelize = sequelize;

// // Import models
// db.User = require("./user.model")(sequelize, DataTypes);
// db.Project = require("./project.model")(sequelize, DataTypes);
// db.UserTeam = require("./userTeam.model")(sequelize, DataTypes);
// db.Task = require("./task.model")(sequelize, DataTypes);
// db.WorkLog = require("./worklog.model")(sequelize, DataTypes);
// db.Leave = require("./leave.model")(sequelize, DataTypes);
// db.Report = require("./report.model")(sequelize, DataTypes);
// db.Team = require("./team.model")(sequelize, DataTypes);
// db.Client = require("./client.model")(sequelize, DataTypes);
// db.ClientProject = require("./clientProject.model")(sequelize, DataTypes);

// // Run associations
// Object.keys(db).forEach((modelName) => {
//   if (db[modelName].associate) {
//     db[modelName].associate(db);
//   }
// });

// // Define associations
// db.Project.belongsToMany(db.Client, {
//   through: db.ClientProject,
//   foreignKey: "projectId",
//   otherKey: "clientId",
// });
// db.Client.belongsToMany(db.Project, {
//   through: db.ClientProject,
//   foreignKey: "clientId",
//   otherKey: "projectId",
// });

// db.User.belongsToMany(db.Team, {
//   through: db.UserTeam,
//   foreignKey: "userId",
//   otherKey: "teamId",
// });
// db.Team.belongsToMany(db.User, {
//   through: db.UserTeam,
//   foreignKey: "teamId",
//   otherKey: "userId",
// });

// db.Project.hasMany(db.Task, { foreignKey: "projectId", onDelete: "CASCADE" });
// db.Task.belongsTo(db.Project, { foreignKey: "projectId" });

// db.User.hasMany(db.Task, { foreignKey: "assignedTo" });
// db.Task.belongsTo(db.User, { foreignKey: "assignedTo", as: "assignee" });

// db.User.hasMany(db.WorkLog, { foreignKey: "userId" });
// db.WorkLog.belongsTo(db.User, { foreignKey: "userId" });

// db.Project.hasMany(db.WorkLog, { foreignKey: "projectId" });
// db.WorkLog.belongsTo(db.Project, { foreignKey: "projectId" });

// db.Task.hasMany(db.WorkLog, { foreignKey: "taskId" });
// db.WorkLog.belongsTo(db.Task, { foreignKey: "taskId" });

// db.User.hasMany(db.Leave, { foreignKey: "userId" });
// db.Leave.belongsTo(db.User, { foreignKey: "userId" });

// db.User.hasMany(db.Report, { foreignKey: "userId" });
// db.Report.belongsTo(db.User, { foreignKey: "userId" });

// db.Project.hasMany(db.Report, { foreignKey: "projectId" });
// db.Report.belongsTo(db.Project, { foreignKey: "projectId" });

// db.Team.hasMany(db.Project, { foreignKey: "teamId", onDelete: "CASCADE" });
// db.Project.belongsTo(db.Team, { foreignKey: "teamId" });

// db.Client.hasMany(db.Project, { foreignKey: "clientId" });
// db.Project.belongsTo(db.Client, { foreignKey: "clientId" });

// module.exports = db;
