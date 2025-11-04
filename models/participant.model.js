module.exports = (sequelize, DataTypes) => {
  const Participant = sequelize.define("Participant", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    role: {
      type: DataTypes.ENUM("member", "admin"),
      defaultValue: "member",
    },
    joinedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  });

  Participant.associate = (models) => {
    Participant.belongsTo(models.User, { as: "user", foreignKey: "userId" });
    Participant.belongsTo(models.Conversation, {
      as: "conversation",
      foreignKey: "conversationId",
    });
  };

  return Participant;
};
