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

  Team.associate = (models) => {
    // Users in teams
    Team.belongsToMany(models.User, {
      through: models.UserTeam,
      foreignKey: "teamId",
      otherKey: "userId",
    });

    // Optional: direct FK if you kept teamId in Project (but probably unnecessary now)
    Team.hasMany(models.Project, {
      foreignKey: "teamId",
      onDelete: "CASCADE",
    });

    // UserTeam reverse association
    Team.hasMany(models.UserTeam, {
      foreignKey: "teamId",
      onDelete: "CASCADE",
    });

    // ✅ Correct many-to-many with projects via TeamProject
    Team.belongsToMany(models.Project, {
      through: models.TeamProject,
      foreignKey: "teamId",
      otherKey: "projectId",
    });
  };

  return Team;
};
