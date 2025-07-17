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
      type: DataTypes.ENUM("Pending", "In Progress", "Review", "Done"),
      defaultValue: "Pending",
    },
  });

  Project.associate = (models) => {
    // Many-to-many with Users through UserTeam
    Project.belongsToMany(models.User, {
      through: models.UserTeam,
      foreignKey: "projectId",
    });

    // ✅ Many-to-many with Teams through TeamProject
    Project.belongsToMany(models.Team, {
      through: models.TeamProject,
      foreignKey: "projectId",
      otherKey: "teamId",
    });

    // Tasks assigned to this project
    Project.hasMany(models.Task, { foreignKey: "projectId" });
  };

  return Project;
};
