// models/auditor.model.js
module.exports = (sequelize, DataTypes) => {
  const Auditor = sequelize.define(
    "Auditor",
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
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      area: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // Store inspectors as JSON array of names (since not required to be Users)
      inspectors: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [], // e.g: ["John Doe", "Jane Smith"]
      },
    },
    {
      tableName: "Auditors",
      timestamps: true,
    }
  );

  return Auditor;
};
