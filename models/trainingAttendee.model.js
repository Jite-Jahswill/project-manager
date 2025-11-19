// models/trainingAttendee.model.js
module.exports = (sequelize, DataTypes) => {
  const TrainingAttendee = sequelize.define(
    "TrainingAttendee",
    {
      attended: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: "TrainingAttendees",
      timestamps: false,
    }
  );
  return TrainingAttendee;
};
