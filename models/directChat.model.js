// models/directChat.model.js
module.exports = (sequelize, DataTypes) => {
  const DirectChat = sequelize.define("DirectChat", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    senderId: { type: DataTypes.INTEGER, allowNull: false },
    receiverId: { type: DataTypes.INTEGER, allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: true },
    type: { type: DataTypes.ENUM("text", "image", "file"), defaultValue: "text" },
    isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
    isEdited: { type: DataTypes.BOOLEAN, defaultValue: false },
    isDeleted: { type: DataTypes.BOOLEAN, defaultValue: false },
  });

  DirectChat.associate = (models) => {
    DirectChat.belongsTo(models.User, { as: "sender", foreignKey: "senderId" });
    DirectChat.belongsTo(models.User, { as: "receiver", foreignKey: "receiverId" });
  };

  return DirectChat;
};
