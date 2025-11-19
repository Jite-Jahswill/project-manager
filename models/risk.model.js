// models/risk.model.js
module.exports = (sequelize, DataTypes) => {
  const Risk = sequelize.define(
    "Risk",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      hazard: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      severity: {
        type: DataTypes.ENUM("Low", "Medium", "High", "Critical"),
        allowNull: false,
      },
      likelihood: {
        type: DataTypes.ENUM("Rare", "Unlikely", "Possible", "Likely", "Almost Certain"),
        allowNull: false,
      },
      mitigation: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("Identified", "In Progress", "Mitigated", "Closed"),
        defaultValue: "Identified",
      },
      ownerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      reviewDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
    },
    {
      tableName: "Risks",
      timestamps: true,
    }
  );

  Risk.associate = (models) => {
    Risk.belongsTo(models.User, { foreignKey: "ownerId", as: "owner" });
  };

  return Risk;
};
