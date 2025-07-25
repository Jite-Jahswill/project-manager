// models/team.model.js
module.exports = (sequelize, DataTypes) => {
  const Team = sequelize.define("Team", {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  //Team.associate = (models) => {
    //Team.belongsToMany(models.User, {
     // through: models.UserTeam,
      //foreignKey: "teamId",
     // otherKey: "userId",
   // });
   // Team.belongsToMany(models.Project, {
    //  through: models.TeamProject,
     // foreignKey: "teamId",
     // otherKey: "projectId",
    //});
    //Team.hasMany(models.UserTeam, {
     // foreignKey: "teamId",
     // onDelete: "CASCADE",
    //});
 // };

  return Team;
};
