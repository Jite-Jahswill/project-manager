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
    // Removed teamId field as it's no longer needed
  });

  Project.associate = (models) => {
    Project.belongsToMany(models.Team, {
      through: models.TeamProject,
      foreignKey: "projectId",
      otherKey: "teamId",
    });
    Project.hasMany(models.Task, {
      foreignKey: "projectId",
      as: "tasks",
      onDelete: "CASCADE",
    });
    // Keep existing associations with Client
    Project.belongsToMany(models.Client, {
      through: models.ClientProject,
      foreignKey: "projectId",
      otherKey: "clientId",
    });
  };

  return Project;
};
