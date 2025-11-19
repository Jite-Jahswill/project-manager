module.exports = (sequelize, DataTypes) => {
  const TrainingAttendee = sequelize.define("TrainingAttendee", {}, { tableName: "TrainingAttendees", timestamps: false });
  return TrainingAttendee;
};
