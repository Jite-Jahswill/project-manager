// models/task.model.js
module.exports = (sequelize, DataTypes) => {
  const Task = sequelize.define(
    "Task",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("To Do", "In Progress", "Review", "Done"),
        defaultValue: "To Do",
      },
      dueDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Projects", key: "id" },
        onDelete: "CASCADE",
      },
      assignedTo: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onDelete: "SET NULL",
      },
    },
    {
      tableName: "Tasks",
      timestamps: true,
    }
  );

  Task.associate = (models) => {
    // Associations are defined in index.js to avoid duplicate aliases
  };

  return Task;
};
