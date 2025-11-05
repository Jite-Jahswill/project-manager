// models/document.model.js
module.exports = (sequelize, DataTypes) => {
  const Document = sequelize.define(
    "Document",
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
      firebaseUrl: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Projects", key: "id" },
      },
      reportId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Reports", key: "id" },
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      size: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      uploadedBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
      },
      status: {
        type: DataTypes.ENUM("pending", "approved", "rejected", "completed", "not complete"),
        allowNull: false,
        defaultValue: "pending",
      },
    },
    {
      timestamps: true,
      tableName: "Documents",
    }
  );

  Document.associate = (models) => {
    Document.belongsTo(models.Project, { foreignKey: "projectId", onDelete: "CASCADE" });
    Document.belongsTo(models.Report, { foreignKey: "reportId", onDelete: "SET NULL" });
    Document.belongsTo(models.User, { foreignKey: "uploadedBy", as: "uploader" });
  };

  return Document;
};
