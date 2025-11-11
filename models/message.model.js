// models/message.model.js
module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define("Message", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    conversationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    senderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    receiverId: {                     // NEW
      type: DataTypes.INTEGER,
      allowNull: true,                // null for group chats
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM("text", "image", "file"),
      defaultValue: "text",
    },
    isEdited: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    isRead: {                         // NEW
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  }, {
    indexes: [
      { fields: ["conversationId"] },
      { fields: ["senderId"] },
      { fields: ["receiverId"] },
      { fields: ["isRead"] },
    ],
  });

  Message.associate = (models) => {
    // Message.belongsTo(models.User, { foreignKey: "senderId", as: "sender" });
    Message.belongsTo(models.User, { foreignKey: "receiverId", as: "receiver" });
    // Message.belongsTo(models.Conversation, { foreignKey: "conversationId" });
  };

  return Message;
};
