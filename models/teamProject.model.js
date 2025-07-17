// models/teamProject.model.js
module.exports = (sequelize, DataTypes) => {
  const TeamProject = sequelize.define("TeamProject", {
    teamId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Teams", key: "id" },
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Projects", key: "id" },
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  TeamProject.associate = (models) => {
    TeamProject.belongsTo(models.Team, { foreignKey: "teamId" });
    TeamProject.belongsTo(models.Project, { foreignKey: "projectId" });
  };

  return TeamProject;
};
