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
    teamId: {
      // Explicitly define teamId
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "Teams",
        key: "id",
      },
    },
  });

  Project.associate = (models) => {
    Project.belongsTo(models.Team, {
      foreignKey: "teamId",
      onDelete: "SET NULL",
    });
    Project.belongsToMany(models.User, {
      through: models.UserTeam,
      foreignKey: "projectId",
    });
    Project.hasMany(models.Task, { foreignKey: "projectId" });
  };

  return Project;
};
