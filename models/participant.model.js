module.exports = (sequelize, DataTypes) => {
  const Participant = sequelize.define("Participant", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    conversationId: DataTypes.INTEGER,
    userId: DataTypes.INTEGER,
  });

  return Participant;
};
