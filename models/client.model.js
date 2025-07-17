module.exports = (sequelize, DataTypes) => {
  const Client = sequelize.define("Client", {
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    image: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  });

  Client.associate = (models) => {
    Client.hasMany(models.Project, { foreignKey: "clientId" });
  };

  return Client;
};
