// models/messageRecipient.model.js
module.exports = (sequelize, DataTypes) => {
  const MessageRecipient = sequelize.define("MessageRecipient", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    messageId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
    isDeleted: { type: DataTypes.BOOLEAN, defaultValue: false }, // soft-delete per recipient
  }, {
    indexes: [
      { fields: ["messageId"] },
      { fields: ["userId"] },
      { unique: true, fields: ["messageId", "userId"] },
    ],
  });

  return MessageRecipient;
};
