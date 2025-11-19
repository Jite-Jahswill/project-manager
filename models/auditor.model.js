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
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      area: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      // Free-text inspector names (supports multiple)
      inspectorNames: {
        type: DataTypes.JSON, // stores array of strings
        allowNull: false,
        defaultValue: [],
        comment: "List of inspector names (internal or external)",
      },
    },
    {
      tableName: "Audits",
      timestamps: true,
      indexes: [
        { fields: ["date"] },
        { fields: ["area"] },
      ],
    }
  );

  return Auditor;
};
