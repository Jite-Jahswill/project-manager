// 📁 models/hseReport.model.js
module.exports = (sequelize, DataTypes) => {
  const HSEReport = sequelize.define(
    "HSEReport",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
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
        references: { model: "Users", key: "id" },
      },
      report: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      firebaseUrls: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
      },
      attachedDocs: {
        type: DataTypes.JSON, // Array of document IDs attached to this report
        allowNull: true,
        defaultValue: [],
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
      tableName: "HSEReports",
    }
  );

  HSEReport.associate = (models) => {
    HSEReport.belongsTo(models.User, { foreignKey: "reporterId", as: "reporter" });
    HSEReport.belongsTo(models.User, { foreignKey: "closedBy", as: "closer" });
    HSEReport.hasMany(models.HseDocument, { foreignKey: "reportId", as: "documents" });
  };

  return HSEReport;
};
