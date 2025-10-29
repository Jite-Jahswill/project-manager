// models/role.model.js
module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define(
    "Role",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      // Store an array of permission **names** (not ids)
      permissions: {
        type: DataTypes.JSON,          // MySQL → JSON, PostgreSQL → JSONB
        allowNull: false,
        defaultValue: [],
      },
    },
    { timestamps: true }
  );

  Role.associate = (models) => {
    Role.belongsToMany(models.User, {
      through: "UserRole",   // tiny join table only for user↔role
      foreignKey: "roleId",
    });
  };

  return Role;
};
