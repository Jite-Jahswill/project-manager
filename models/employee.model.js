// models/employee.model.js
module.exports = (sequelize, DataTypes) => {
  const Employee = sequelize.define("Employee", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    employeeId: {
      type: DataTypes.STRING,
      unique: true,
      defaultValue: () => `EMP-${Date.now().toString().slice(-6)}`,
    },
    firstName: { type: DataTypes.STRING, allowNull: false },
    lastName: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    department: {
      type: DataTypes.ENUM("Operations", "IT", "Finance", "HR", "Sales", "Marketing", "Executive"),
      allowNull: false,
    },
    position: { type: DataTypes.STRING, allowNull: false },
    hireDate: { type: DataTypes.DATEONLY },
    status: {
      type: DataTypes.ENUM("Active", "On Leave", "Terminated", "Pending Approval"),
      defaultValue: "Pending Approval",
    },
    trainingCompletion: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: { min: 0, max: 100 },
    },
    approvedBy: { type: DataTypes.INTEGER, allowNull: true },
    approvedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    tableName: "Employees",
    timestamps: true,
  });

  Employee.associate = (models) => {
    Employee.belongsTo(models.User, { foreignKey: "approvedBy", as: "approver" });
  };

  return Employee;
};
