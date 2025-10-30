// models/task.model.js
module.exports = (sequelize, DataTypes) => {
  const Task = sequelize.define("Task", {
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
    },
    status: {
      type: DataTypes.ENUM("To Do", "In Progress", "Review", "Done"),
      defaultValue: "To Do",
    },
    dueDate: {
      type: DataTypes.DATE,
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Projects",
        key: "id",
      },
    },
    assignedTo: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Users",
        key: "id",
      },
    },
  });

 // Task.associate = (models) => {
  //  Task.belongsTo(models.Project, {
    //  foreignKey: "projectId",
    //  onDelete: "CASCADE",
 //   });
   // Task.belongsTo(models.User, {
     // foreignKey: "assignedTo",
    //  as: "assignee",
   // });
 // };

  return Task;
};
