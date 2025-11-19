// models/financeExpense.model.js
module.exports = (sequelize, DataTypes) => {
  const FinanceExpense = sequelize.define("FinanceExpense", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    requestId: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      defaultValue: () => `PAY-${Date.now().toString().slice(-6)}`,
    },
    vendor: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    category: {
      type: DataTypes.ENUM(
        "Operations", "IT Infrastructure", "Marketing", "Human Resources",
        "Travel", "Office Supplies", "Professional Services", "Utilities"
      ),
      allowNull: false,
    },
    expenseDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("Pending", "Approved", "Rejected"),
      defaultValue: "Pending",
    },
    submittedBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    approvedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    tableName: "FinanceExpenses",
    timestamps: true,
  });

  FinanceExpense.associate = (models) => {
    FinanceExpense.belongsTo(models.User, { foreignKey: "submittedBy", as: "submitter" });
    FinanceExpense.belongsTo(models.User, { foreignKey: "approvedBy", as: "approver" });
  };

  return FinanceExpense;
};
