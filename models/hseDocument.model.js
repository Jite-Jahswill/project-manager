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
        type: DataTypes.JSON, // Store an array of file URLs
        allowNull: false,
        defaultValue: [],
      },
      uploadedBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Users",
          key: "id",
        },
      },
      reportId: {
        type: DataTypes.INTEGER,
        allowNull: true, // Optional link to HSE report
        references: {
          model: "HSEReports",
          key: "id",
        },
      },
      type: {
        type: DataTypes.STRING, // e.g., image, pdf, docx
        allowNull: false,
      },
      size: {
        type: DataTypes.INTEGER, // File size (bytes)
        allowNull: false,
      },
      createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
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
