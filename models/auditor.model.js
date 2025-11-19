// models/audit.model.js
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
    },
    {
      tableName: "Audits",
      timestamps: true,
    }
  );

  Auditor.associate = (models) => {
    Auditor.belongsToMany(models.User, {
      through: "AuditorAssignments",
      as: "inspectors",
      foreignKey: "auditId",
    });
  };

  return Auditor;
};
