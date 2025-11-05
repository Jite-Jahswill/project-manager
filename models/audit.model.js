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
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      action: {
        type: DataTypes.ENUM("CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT"),
        allowNull: false,
      },
      model: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      recordId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      oldValues: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      newValues: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      ipAddress: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      timestamps: true,
      tableName: "Audits",
      indexes: [
        { fields: ["model"] },
        { fields: ["action"] },
        { fields: ["userId"] },
        { fields: ["createdAt"] },
      ],
    }
  );

  Audit.associate = (models) => {
    Audit.belongsTo(models.User, { foreignKey: "userId", as: "user" });
  };

  return Audit;
};
