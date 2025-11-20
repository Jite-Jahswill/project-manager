// controllers/hr.controller.js
const { Employee, User, sequelize } = require("../models");
const sendMail = require("../utils/mailer");

// ──────────────────────
// 1. HR DASHBOARD KPIs
// ──────────────────────
exports.getHrDashboard = async (req, res) => {
  try {
    const [result] = await sequelize.query(`
      SELECT 
        COUNT(*) as totalEmployees,
        COUNT(CASE WHEN status = 'Pending Approval' THEN 1 END) as pendingHires,
        COUNT(CASE WHEN status = 'Active' THEN 1 END) as activeEmployees,
        ROUND(AVG(trainingCompletion), 1) as avgTrainingCompletion
      FROM Employees;
    `);

    const kpis = result[0] || {};

    res.json({
      kpis: {
        totalEmployees: Number(kpis.totalEmployees || 0),
        activeEmployees: Number(kpis.activeEmployees || 0),
        pendingHires: Number(kpis.pendingHires || 0),
        avgTrainingCompletion: Number(kpis.avgTrainingCompletion || 0),
      },
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ──────────────────────
// 2. CREATE NEW EMPLOYEE (Pending Approval)
// ──────────────────────
exports.createEmployee = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { firstName, lastName, email, department, position, hireDate } = req.body;

    const employee = await Employee.create({
      firstName,
      lastName,
      email,
      department,
      position,
      hireDate: hireDate || new Date(),
      status: "Pending Approval",
      trainingCompletion: 0
    }, { transaction: t });

    await t.commit();

    // Notify HR team
    await sendMail({
      to: "hr@company.com",
      subject: `New Hire Pending Approval: ${firstName} ${lastName}`,
      html: `<h3>New Employee Record Created</h3>
             <p><strong>${firstName} ${lastName}</strong> - ${position}</p>
             <p>Department: ${department}</p>
             <p>Email: ${email}</p>
             <p>Awaiting your approval.</p>`
    });

    res.status(201).json({ message: "Employee created – pending approval", employee });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// ──────────────────────
// 3. GET ALL + FULL SEARCH & FILTER
// ──────────────────────
exports.getAllEmployees = async (req, res) => {
  try {
    const { search, status, department, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let where = [];
    let reps = { limit: parseInt(limit), offset };

    if (search) {
      where.push(`(firstName LIKE :search OR lastName LIKE :search OR email LIKE :search OR employeeId LIKE :search)`);
      reps.search = `%${search}%`;
    }
    if (status) { where.push(`status = :status`); reps.status = status; }
    if (department) { where.push(`department = :department`); reps.department = department; }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [employees, [{ total }]] = await Promise.all([
      sequelize.query(
        `SELECT e.*, 
                u.firstName AS approverFirstName, u.lastName AS approverLastName
         FROM Employees e
         LEFT JOIN Users u ON e.approvedBy = u.id
         ${whereClause}
         ORDER BY e.createdAt DESC
         LIMIT :limit OFFSET :offset`,
        { replacements: reps, type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(`SELECT COUNT(*) as total FROM Employees e ${whereClause}`, {
        replacements: reps, type: sequelize.QueryTypes.SELECT
      })
    ]);

    res.json({
      employees,
      pagination: {
        total: Number(total),
        page: parseInt(page),
        totalPages: Math.ceil(total / limit),
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ──────────────────────
// 4. UPDATE EMPLOYEE
// ──────────────────────
exports.updateEmployee = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const updates = req.body;

    const employee = await Employee.findByPk(id, { transaction: t });
    if (!employee) {
      await t.rollback();
      return res.status(404).json({ message: "Employee not found" });
    }

    // Prevent editing approved employees without proper permission (optional)
    if (employee.status === "Active" && !req.user.permissions.includes("hr:manage")) {
      await t.rollback();
      return res.status(403).json({ message: "Cannot edit active employees" });
    }

    await employee.update(updates, { transaction: t });
    await t.commit();

    res.json({ message: "Employee updated", employee });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// ──────────────────────
// 5. DELETE EMPLOYEE (Only Pending or Terminated)
// ──────────────────────
exports.deleteEmployee = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    const employee = await Employee.findOne({
      where: { id, status: ["Pending Approval", "Terminated"] },
      transaction: t
    });

    if (!employee) {
      await t.rollback();
      return res.status(403).json({ message: "Cannot delete active employee" });
    }

    await employee.destroy({ transaction: t });
    await t.commit();

    res.json({ message: "Employee record deleted", deleted: { id, name: `${employee.firstName} ${employee.lastName}` } });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// ──────────────────────
// 6. APPROVE HIRE
// ──────────────────────
exports.approveHire = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const employee = await Employee.findOne({
      where: { id, status: "Pending Approval" },
      transaction: t
    });

    if (!employee) {
      await t.rollback();
      return res.status(404).json({ message: "Employee not found or already processed" });
    }

    await employee.update({
      status: "Active",
      approvedBy: userId,
      approvedAt: new Date()
    }, { transaction: t });

    await t.commit();

    await sendMail({
      to: employee.email,
      subject: "Welcome Aboard! Your Employment is Approved",
      html: `<h3>Congratulations ${employee.firstName}!</h3>
             <p>Your role as <strong>${employee.position}</strong> in <strong>${employee.department}</strong> has been officially approved.</p>
             <p>Welcome to the team!</p>`
    });

    res.json({ message: "Employee approved and activated", employee });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};
