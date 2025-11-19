// models/audit.model.js
module.exports = (sequelize, DataTypes) => {
  const Audit = sequelize.define(
    "Audit",
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

  Audit.associate = (models) => {
    Audit.belongsToMany(models.User, {
      through: "AuditAssignments",
      as: "inspectors",
      foreignKey: "auditId",
    });
  };

  return Audit;
};
