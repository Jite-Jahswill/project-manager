// models/project.model.js
module.exports = (sequelize, DataTypes) => {
  const Project = sequelize.define("Project", {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
    },
    startDate: {
      type: DataTypes.DATE,
    },
    endDate: {
      type: DataTypes.DATE,
    },
    status: {
      type: DataTypes.ENUM("To Do", "In Progress", "Review", "Done"),
      defaultValue: "To Do",
    },
  });

  //Project.associate = (models) => {
    //Project.belongsToMany(models.Team, {
     // through: models.TeamProject,
      //foreignKey: "projectId",
      //otherKey: "teamId",
    //});
  //  Project.belongsToMany(models.User, {
     // through: models.UserTeam,
      //foreignKey: "projectId",
    //});
   // Project.hasMany(models.Task, {
     // foreignKey: "projectId",
     // as: "tasks",
    //  onDelete: "CASCADE",
    //});
 // };

  return Project;
};
