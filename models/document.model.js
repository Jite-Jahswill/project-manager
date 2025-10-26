module.exports = (sequelize, DataTypes) => {
  const Document = sequelize.define("Document", {
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
      references: {
        model: "Projects",
        key: "id",
      },
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false, // e.g., "pdf", "image", "video", "doc"
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: false, // Size in bytes
    },
    uploadedBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  });

  Document.associate = (models) => {
    Document.belongsTo(models.Project, { foreignKey: "projectId", onDelete: "CASCADE" });
    Document.belongsTo(models.User, { foreignKey: "uploadedBy", as: "uploader" });
  };

  return Document;
};
