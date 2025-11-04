module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define("Message", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    senderId: { type: DataTypes.INTEGER, allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false },
    type: {
      type: DataTypes.ENUM("text", "image", "file", "system"),
      defaultValue: "text",
    },
    isEdited: { type: DataTypes.BOOLEAN, defaultValue: false },
    isDeleted: { type: DataTypes.BOOLEAN, defaultValue: false },
  });

  Message.associate = (models) => {
    Message.belongsTo(models.Conversation, {
      as: "conversation",
      foreignKey: "conversationId",
    });
    Message.belongsTo(models.User, {
      as: "sender",
      foreignKey: "senderId",
    });
  };

  return Message;
};
