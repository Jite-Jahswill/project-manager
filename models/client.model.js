const bcrypt = require("bcryptjs");

module.exports = (sequelize, DataTypes) => {
  const Client = sequelize.define(
    "Client",
    {
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
      password: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      image: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      emailVerified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      otp: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      otpExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      hooks: {
        beforeCreate: async (client) => {
          if (client.password) {
            client.password = await bcrypt.hash(client.password, 10);
          }
        },
        beforeUpdate: async (client) => {
          if (client.changed("password")) {
            client.password = await bcrypt.hash(client.password, 10);
          }
        },
      },
    }
  );

  Client.associate = (models) => {
    // Remove one-to-many association
    // Client.hasMany(models.Project, { foreignKey: "clientId" });
    // Define many-to-many association (optional, as it's already in index.js)
    Client.belongsToMany(models.Project, {
      through: models.ClientProject,
      foreignKey: "clientId",
      otherKey: "projectId",
      as: "projects",
    });
  };

  return Client;
};
