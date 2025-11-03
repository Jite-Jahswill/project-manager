module.exports = (sequelize, DataTypes) => {
  const Conversation = sequelize.define("Conversation", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING, // "Group Chat: Project Alpha" or null for 1:1
    },
    isGroup: {
      type: DataTypes.BOOLEAN,
      defaultValue: false, // false = 1:1, true = group
    },
    type: {
      type: DataTypes.ENUM("direct", "group"),
      defaultValue: "direct",
    },
  });

  Conversation.associate = (models) => {
    Conversation.belongsToMany(models.User, { through: "Participant", as: "participants" });
    Conversation.hasMany(models.Message, { foreignKey: "conversationId" });
  };

  return Conversation;
};
