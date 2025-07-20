module.exports = (sequelize, DataTypes) => {
  const Report = sequelize.define("Report", {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    teamId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  });

  Report.associate = (models) => {
    Report.belongsTo(models.User, { foreignKey: "userId" });
    Report.belongsTo(models.Project, { foreignKey: "projectId" });
    Report.belongsTo(models.Team, { foreignKey: "teamId" });
  };

  return Report;
};
