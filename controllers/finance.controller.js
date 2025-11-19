// controllers/finance.controller.js
const { FinanceExpense, User, sequelize } = require("../models");
const sendMail = require("../utils/mailer");

// CREATE EXPENSE REQUEST
exports.submitExpense = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { vendor, amount, category, expenseDate, description } = req.body;
    const userId = req.user.id;

    const expense = await FinanceExpense.create({
      vendor, amount, category, expenseDate, description, submittedBy: userId
    }, { transaction: t });

    await t.commit();

    // Notify Finance Team
    await sendMail({
      to: "finance@company.com",
      subject: `New Payment Request: ${expense.requestId}`,
      html: `<h3>New Expense Submitted</h3>
             <p><strong>Request ID:</strong> ${expense.requestId}</p>
             <p><strong>Vendor:</strong> ${vendor}</p>
             <p><strong>Amount:</strong> $${parseFloat(amount).toLocaleString()}</p>
             <p><strong>Category:</strong> ${category}</p>
             <p><strong>Submitted by:</strong> ${req.user.firstName} ${req.user.lastName}</p>`
    });

    res.status(201).json(expense);
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// APPROVE EXPENSE (RAW MYSQL)
exports.approveExpense = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await sequelize.query(
      `UPDATE FinanceExpenses 
       SET status = 'Approved', approvedBy = :userId, approvedAt = NOW(), updatedAt = NOW()
       WHERE id = :id AND status = 'Pending'`,
      { replacements: { id, userId }, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    const [updated] = await sequelize.query(
      `SELECT * FROM FinanceExpenses WHERE id = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    if (!updated) {
      await t.rollback();
      return res.status(404).json({ message: "Expense not found or already processed" });
    }

    await t.commit();

    // Notify submitter
    const submitter = await User.findByPk(updated.submittedBy);
    await sendMail({
      to: submitter.email,
      subject: `Payment Approved: ${updated.requestId}`,
      html: `<h3>Your payment request has been APPROVED</h3>
             <p><strong>Amount:</strong> $${parseFloat(updated.amount).toLocaleString()}</p>
             <p><strong>Vendor:</strong> ${updated.vendor}</p>
             <p>Payment will be processed shortly.</p>`
    });

    res.json({ message: "Expense approved", expense: updated });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// REJECT EXPENSE
exports.rejectExpense = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { reason } = req.body;

    await sequelize.query(
      `UPDATE FinanceExpenses SET status = 'Rejected', updatedAt = NOW() WHERE id = :id AND status = 'Pending'`,
      { replacements: { id }, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    const [updated] = await sequelize.query(`SELECT * FROM FinanceExpenses WHERE id = :id`, {
      replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t
    });

    if (!updated) {
      await t.rollback();
      return res.status(404).json({ message: "Not found or already processed" });
    }

    await t.commit();

    const submitter = await User.findByPk(updated.submittedBy);
    await sendMail({
      to: submitter.email,
      subject: `Payment Rejected: ${updated.requestId}`,
      html: `<h3>Your payment request was rejected</h3>
             <p><strong>Reason:</strong> ${reason || "Not specified"}</p>
             <p>Please contact Finance for clarification.</p>`
    });

    res.json({ message: "Expense rejected" });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// GET PENDING APPROVALS
exports.getPendingApprovals = async (req, res) => {
  try {
    const pending = await FinanceExpense.findAll({
      where: { status: "Pending" },
      include: [{ model: User, as: "submitter", attributes: ["firstName", "lastName"] }],
      order: [["createdAt", "DESC"]]
    });
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// FINANCE DASHBOARD KPIs
exports.getFinanceDashboard = async (req, res) => {
  try {
    const [results] = await sequelize.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN status = 'Approved' THEN amount ELSE 0 END), 0) as totalSpent,
        COALESCE(SUM(CASE WHEN status = 'Pending' THEN amount ELSE 0 END), 0) as pendingAmount,
        COUNT(CASE WHEN status = 'Pending' THEN 1 END) as pendingCount,
        COALESCE(SUM(CASE WHEN status = 'Approved' AND MONTH(createdAt) = MONTH(CURDATE()) THEN amount ELSE 0 END), 0) as monthlySpend
      FROM FinanceExpenses;
    `);

    const { totalSpent, pendingAmount, pendingCount, monthlySpend } = results[0];

    res.json({
      kpis: {
        totalApprovedSpend: Number(totalSpent),
        pendingApprovalAmount: Number(pendingAmount),
        pendingApprovalCount: Number(pendingCount || 0),
        thisMonthSpend: Number(monthlySpend),
        budgetUtilization: 78.4, // You can link to real budget later
      },
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
