module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define("Message", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    content: {
      type: DataTypes.TEXT, // text or file URL
    },
    type: {
      type: DataTypes.ENUM("text", "image", "file", "system"),
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
    conversationId: {
      type: DataTypes.INTEGER,
      references: {
        model: "Conversations",
        key: "id",
      },
    },
    senderId: {
      type: DataTypes.INTEGER,
      references: {
        model: "Users",
        key: "id",
      },
    },
  });

  Message.associate = (models) => {
    Message.belongsTo(models.Conversation, { foreignKey: "conversationId" });
    Message.belongsTo(models.User, { as: "sender", foreignKey: "senderId" });
  };

  return Message;
};
