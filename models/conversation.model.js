module.exports = (sequelize, DataTypes) => {
  const Conversation = sequelize.define("Conversation", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: true }, // for groups
    type: {
      type: DataTypes.ENUM("direct", "group"),
      defaultValue: "direct",
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  });

  Conversation.associate = (models) => {
    Conversation.belongsTo(models.User, {
      foreignKey: "createdBy",
      as: "creator",
    });
    Conversation.belongsToMany(models.User, {
      through: models.Participant,
      as: "participants",
      foreignKey: "conversationId",
    });
    Conversation.hasMany(models.Message, {
      as: "messages",
      foreignKey: "conversationId",
    });
  };

  return Conversation;
};
