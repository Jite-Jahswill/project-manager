module.exports = (sequelize, DataTypes) => {
  const RolePermission = sequelize.define("RolePermission", {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
  });

  return RolePermission;
};
