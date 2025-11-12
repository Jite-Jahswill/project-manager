// models/conversation.model.js
module.exports = (sequelize, DataTypes) => {
  const Conversation = sequelize.define("Conversation", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    type: { type: DataTypes.ENUM("direct", "group"), defaultValue: "direct" },
    name: { type: DataTypes.STRING, allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
  });

  Conversation.associate = (models) => {
    Conversation.belongsToMany(models.User, {
      through: models.Participant,
      foreignKey: "conversationId",
      as: "participants",
    });
    Conversation.hasMany(models.Message, { foreignKey: "conversationId", as: "messages" });
  };

  return Conversation;
};
