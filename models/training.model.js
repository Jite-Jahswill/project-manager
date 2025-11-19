// models/training.model.js
module.exports = (sequelize, DataTypes) => {
  const Training = sequelize.define(
    "Training",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      courseName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      nextTrainingDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("Scheduled", "In Progress", "Urgent", "Completed", "Cancelled"),
        defaultValue: "Scheduled",
      },
      progress: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: { min: 0, max: 100 },
      },
      reminderSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "Trainings",
      timestamps: true,
    }
  );

  Training.associate = (models) => {
    Training.belongsToMany(models.User, {
      through: "TrainingAttendees",
      as: "attendees",
      foreignKey: "trainingId",
    });
  };

  return Training;
};
