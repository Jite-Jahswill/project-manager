// models/hseReport.model.js
module.exports = (sequelize, DataTypes) => {
  const HSEReport = sequelize.define(
    "HSEReport",
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
        references: {
          model: "Users",
          key: "id",
        },
      },
      report: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      supportingDocUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      timestamps: true,
      tableName: "HSEReports",
    }
  );

  HSEReport.associate = (models) => {
    HSEReport.belongsTo(models.User, {
      foreignKey: "reporterId",
      as: "reporter",
    });
  };

  return HSEReport;
};
