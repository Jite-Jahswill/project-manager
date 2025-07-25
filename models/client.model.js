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
      allowNull: true, // Change to false if required
    },
    otpExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true, // Change to false if required
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true, // Change to false if you want it to be required
    },
  });

  Client.associate = (models) => {
    Client.hasMany(models.Project, { foreignKey: "clientId" });
  };

  return Client;
};
