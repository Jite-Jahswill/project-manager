// models/worklog.model.js
module.exports = (sequelize, DataTypes) => {
  const WorkLog = sequelize.define("WorkLog", {
    hoursWorked: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING,
    },
  });

  return WorkLog;
};
