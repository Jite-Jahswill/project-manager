module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define("User", {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
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
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // role: {
    //   type: DataTypes.ENUM("admin", "manager", "staff"),
    //   defaultValue: "staff",
    // },
    emailVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    image: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: true, // Change to false if you want it to be required
    },
    otp: {
      type: DataTypes.STRING,
      allowNull: true, // Change to false if you want it to be required
    },
    otpExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true, // Change to false if you want it to be required
    },
    fullName: {
      type: DataTypes.VIRTUAL,
      get() {
        return `${this.firstName} ${this.lastName}`;
      },
    },
  });

  User.associate = (models) => {
    User.hasMany(models.UserTeam, { foreignKey: "userId" });

    User.belongsToMany(models.Role, {
      through: "UserRole",
      foreignKey: "userId",
    });
    
  //   User.belongsToMany(models.Role, {
  //   through: models.UserRole,
  //   foreignKey: "userId",
  //   otherKey: "roleId",
  // });
  };

  return User;
};
