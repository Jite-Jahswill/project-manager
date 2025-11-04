// models/report.model.js
module.exports = (sequelize, DataTypes) => {
  const Report = sequelize.define(
    "Report",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      dateOfReport: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      timeOfReport: {
        type: DataTypes.TIME,
        allowNull: false,
      },
      reporterId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      report: {
        type: DataTypes.TEXT, // long text
        allowNull: false,
      },
      supportingDocUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("open", "pending", "closed"),
        allowNull: false,
        defaultValue: "open",
      },
      closedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      closedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
    },
    {
      timestamps: true,
      tableName: "Reports",
    }
  );

  Report.associate = (models) => {
    Report.belongsTo(models.User, { foreignKey: "reporterId", as: "reporter" });
    Report.belongsTo(models.User, { foreignKey: "closedBy", as: "closer" });
    // Keep project/team if you still need them
    Report.belongsTo(models.Project, { foreignKey: "projectId", as: "project" });
    Report.belongsTo(models.Team, { foreignKey: "teamId", as: "team" });
  };

  return Report;
};
