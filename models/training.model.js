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
