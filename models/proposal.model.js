// models/proposal.model.js
module.exports = (sequelize, DataTypes) => {
  const Proposal = sequelize.define("Proposal", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    proposalId: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      defaultValue: () => `PROP-${Date.now().toString().slice(-7)}`,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    clientName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    value: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.STRING(3),
      defaultValue: "USD",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("Draft", "Submitted", "Under Review", "Approved", "Rejected", "Won", "Lost"),
      defaultValue: "Draft",
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
    validUntil: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
  }, {
    tableName: "Proposals",
    timestamps: true,
  });

  Proposal.associate = (models) => {
    Proposal.belongsTo(models.User, { foreignKey: "submittedBy", as: "author" });
    Proposal.belongsTo(models.User, { foreignKey: "approvedBy", as: "approver" });
  };

  return Proposal;
};
