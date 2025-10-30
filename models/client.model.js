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
      allowNull: true,
    },
    otpExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    cacCertificate: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    tin: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    taxClearance: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    corporateProfile: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    address: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    state: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    country: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    bankName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    accountName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    approvalStatus: {
      type: DataTypes.ENUM("pending", "approved", "rejected"),
      defaultValue: "pending",
      allowNull: false,
    },
  });

  // Client.associate = (models) => {
  //   Client.hasMany(models.Project, { foreignKey: "clientId" });
  // };

  return Client;
};
