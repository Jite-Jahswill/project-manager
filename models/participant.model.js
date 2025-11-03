module.exports = (sequelize, DataTypes) => {
  const Participant = sequelize.define("Participant", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    joinedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  });

  return Participant;
};
