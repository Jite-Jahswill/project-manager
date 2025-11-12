// models/message.model.js
module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define("Message", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    senderId: { type: DataTypes.INTEGER, allowNull: false },
    receiverId: { type: DataTypes.INTEGER, allowNull: true }, // null = group
    content: { type: DataTypes.TEXT, allowNull: true },
    type: { type: DataTypes.ENUM("text", "image", "file"), defaultValue: "text" },
    isEdited: { type: DataTypes.BOOLEAN, defaultValue: false },
    isDeleted: { type: DataTypes.BOOLEAN, defaultValue: false },
    isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
  }, {
    indexes: [
      { fields: ["conversationId"] },
      { fields: ["senderId"] },
      { fields: ["receiverId"] },
      { fields: ["isRead"] },
    ],
  });

  return Message;
};
