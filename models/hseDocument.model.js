// models/hseDocument.model.js
module.exports = (sequelize, DataTypes) => {
  const HseDocument = sequelize.define(
    "HseDocument",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      firebaseUrls: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      uploadedBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
      },
      reportId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "HSEReports", key: "id" },
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      size: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: "HseDocuments",
      timestamps: true,
    }
  );

  HseDocument.associate = (models) => {
    HseDocument.belongsTo(models.User, { foreignKey: "uploadedBy", as: "uploader" });
    HseDocument.belongsTo(models.HSEReport, { foreignKey: "reportId", as: "report" });
  };

  return HseDocument;
};
