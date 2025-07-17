module.exports = (sequelize, DataTypes) => {
  const UserTeam = sequelize.define("UserTeam", {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
    },
    teamId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Teams",
        key: "id",
      },
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: "Projects",
        key: "id",
      },
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "Member",
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  UserTeam.associate = (models) => {
    UserTeam.belongsTo(models.User, {
      foreignKey: "userId",
      onDelete: "CASCADE",
    });
    UserTeam.belongsTo(models.Team, {
      foreignKey: "teamId",
      onDelete: "CASCADE",
    });
    UserTeam.belongsTo(models.Project, {
      foreignKey: "projectId",
      onDelete: "SET NULL",
    });
  };

  return UserTeam;
};
