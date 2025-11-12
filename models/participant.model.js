// models/participant.model.js
module.exports = (sequelize, DataTypes) => {
  const Participant = sequelize.define("Participant", {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    conversationId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
  }, {
    indexes: [{ unique: true, fields: ["conversationId", "userId"] }],
  });

  return Participant;
};
