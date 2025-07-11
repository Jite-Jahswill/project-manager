// models/clientProject.model.js
module.exports = (sequelize, DataTypes) => {
  const ClientProject = sequelize.define("ClientProject", {
    clientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Clients", // Ensure this matches the table name for the Client model
        key: "id",
      },
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Projects", // Ensure this matches the table name for the Project model
        key: "id",
      },
    },
  });

  return ClientProject;
};
