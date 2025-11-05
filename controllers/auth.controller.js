// controllers/auth.controller.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, Role, sequelize } = require("../models");
const sendMail = require("../utils/mailer");
const crypto = require("crypto");

// Generate 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ---------------------------------------------------------------------
// REGISTER USER
// ---------------------------------------------------------------------
exports.register = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { firstName, lastName, email, roleName = "staff", phoneNumber } = req.body;
    const image = req.uploadedFiles?.[0]?.firebaseUrl;

    if (!firstName || !lastName || !email || !phoneNumber || !image) {
      await t.rollback();
      return res.status(400).json({ message: "firstName, lastName, email, phoneNumber, and image are required" });
    }

    // Find role by name
    const role = await Role.findOne({ where: { name: roleName }, transaction: t });
    if (!role) {
      await t.rollback();
      return res.status(400).json({ message: `Role '${roleName}' not found` });
    }

    // Check uniqueness
    const existingEmail = await User.findOne({ where: { email }, transaction: t });
    if (existingEmail) {
      await t.rollback();
      return res.status(409).json({ message: "Email already exists" });
    }

    const existingPhone = await User.findOne({ where: { phoneNumber }, transaction: t });
    if (existingPhone) {
      await t.rollback();
      return res.status(409).json({ message: "Phone number already in use" });
    }

    // Auto-generate password + OTP
    const autoPassword = crypto.randomBytes(8).toString("hex");
    const hashedPassword = await bcrypt.hash(autoPassword, 10);
    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const user = await User.create(
      {
        firstName,
        lastName,
        email,
        password: hashedPassword,
        roleId: role.id,
        image,
        phoneNumber,
        emailVerified: false,
        otp: hashedOTP,
        otpExpiresAt,
      },
      { transaction: t }
    );

    await sendMail({
      to: user.email,
      subject: "Welcome! Verify Your Email",
      html: `
        <p>Hello ${user.firstName},</p>
        <p>Your account has been created.</p>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Password:</strong> ${autoPassword}</p>
        <p><strong>OTP:</strong> ${otp} (expires in 10 mins)</p>
        <p>Best,<br>Team</p>
      `,
    });

    await t.commit();

    res.status(201).json({
      message: "User registered. OTP and password sent.",
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        image: user.image,
        role: role.name,
        rolePermissions: user.role.permissions,
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("Register error:", error);
    res.status(500).json({ message: "Failed to register", details: error.message });
  }
};

// ---------------------------------------------------------------------
// LOGIN USER (inject permissions into JWT)
// ---------------------------------------------------------------------
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Include role so we can return role name in response
    const user = await User.findOne({
      where: { email },
      include: [{ model: Role, as: "role" }], // ensure alias matches model
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    // JWT only carries user ID (and optionally role name)
    const token = jwt.sign(
      { id: user.id, role: user.role?.name || "unknown" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role?.name || "unknown",
      },
    });
  } catch (error) {
    console.error("Login error:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to login", details: error.message });
  }
};


// ---------------------------------------------------------------------
// GET ALL USERS (with role name)
// ---------------------------------------------------------------------
exports.getAllUsers = async (req, res) => {
  try {
    const { role, firstName, lastName, page = 1, limit = 20 } = req.query;
    const where = {};
    const roleWhere = {};

    if (role) roleWhere.name = role;
    if (firstName) where.firstName = { [sequelize.Op.like]: `%${firstName}%` };
    if (lastName) where.lastName = { [sequelize.Op.like]: `%${lastName}%` };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { count, rows } = await User.findAndCountAll({
      where,
      include: [
        {
          model: Role,
          as: "role", // ✅ Important: must match alias in association
          where: Object.keys(roleWhere).length ? roleWhere : undefined,
          attributes: ["name"],
        },
      ],
      attributes: { exclude: ["password", "otp", "otpExpiresAt"] },
      limit: parseInt(limit),
      offset,
    });

    const totalPages = Math.ceil(count / limit);

    const users = rows.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phoneNumber: u.phoneNumber,
      role: u.role?.name || "unknown",
    }));

    res.json({
      users,
      pagination: { currentPage: +page, totalPages, totalItems: count, itemsPerPage: +limit },
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

// ---------------------------------------------------------------------
// GET SINGLE USER
// ---------------------------------------------------------------------
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const user = await User.findByPk(id, {
      include: [{ model: Role, as: "role", attributes: ["name"] }], // ✅ include alias
      attributes: { exclude: ["password", "otp", "otpExpiresAt"] },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role?.name || "unknown",
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

// ---------------------------------------------------------------------
// UPDATE USER (raw SQL)
// ---------------------------------------------------------------------
exports.updateUser = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { firstName, lastName, email, phoneNumber } = req.body;
    const image = req.uploadedFiles?.[0]?.firebaseUrl;

    const user = await User.findByPk(id, { transaction: t });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ error: "User not found" });
    }

    // Uniqueness checks
    if (email && email !== user.email) {
      const exists = await User.findOne({ where: { email }, transaction: t });
      if (exists) {
        await t.rollback();
        return res.status(409).json({ error: "Email already in use" });
      }
    }
    if (phoneNumber && phoneNumber !== user.phoneNumber) {
      const exists = await User.findOne({ where: { phoneNumber }, transaction: t });
      if (exists) {
        await t.rollback();
        return res.status(409).json({ error: "Phone number already in use" });
      }
    }

    await sequelize.query(
      `UPDATE Users 
       SET firstName = :firstName, 
           lastName = :lastName, 
           email = :email, 
           phoneNumber = :phoneNumber, 
           image = COALESCE(:image, image)
       WHERE id = :id`,
      {
        replacements: {
          firstName: firstName || user.firstName,
          lastName: lastName || user.lastName,
          email: email || user.email,
          phoneNumber: phoneNumber || user.phoneNumber,
          image,
          id,
        },
        type: sequelize.QueryTypes.UPDATE,
        transaction: t,
      }
    );

    const updated = await User.findByPk(id, {
      include: [{ model: Role, attributes: ["name"] }],
      attributes: { exclude: ["password", "otp", "otpExpiresAt"] },
      transaction: t,
    });

    const previous = await Model.findByPk(id);
    req.body._previousData = previous.toJSON();

    await t.commit();

    res.json({
      message: "User updated",
      user: {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
        phoneNumber: updated.phoneNumber,
        image: updated.image,
        role: updated.Role?.name,
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("Update user error:", error);
    res.status(500).json({ error: "Update failed" });
  }
};

// ---------------------------------------------------------------------
// UPDATE USER ROLE (by role name)
// ---------------------------------------------------------------------
exports.updateUserRole = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { role: roleName } = req.body;

    if (!roleName) return res.status(400).json({ error: "Role name required" });

    const role = await Role.findOne({ where: { name: roleName }, transaction: t });
    if (!role) {
      await t.rollback();
      return res.status(400).json({ error: `Role '${roleName}' not found` });
    }

    const user = await User.findByPk(id, { transaction: t });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ error: "User not found" });
    }

    await sequelize.query(
      `UPDATE Users SET roleId = :roleId WHERE id = :id`,
      {
        replacements: { roleId: role.id, id },
        type: sequelize.QueryTypes.UPDATE,
        transaction: t,
      }
    );

    await sendMail({
      to: user.email,
      subject: "Role Updated",
      html: `<p>Hello ${user.firstName},</p><p>Your role is now <strong>${role.name}</strong>.</p>`,
    });

    const updated = await User.findByPk(id, {
      include: [{ model: Role, attributes: ["name"] }],
      transaction: t,
    });

    const previous = await Model.findByPk(id);
    req.body._previousData = previous.toJSON();

    await t.commit();

    res.json({
      message: "Role updated",
      user: {
        id: updated.id,
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email,
        role: updated.Role.name,
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("Update role error:", error);
    res.status(500).json({ error: "Failed to update role" });
  }
};

// ---------------------------------------------------------------------
// DELETE USER
// ---------------------------------------------------------------------
exports.deleteUser = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const user = await User.findByPk(id, { transaction: t });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ error: "User not found" });
    }

    await user.destroy({ transaction: t });
    req.body._deletedData = report.toJSON();
    await t.commit();
    res.json({ message: "User deleted" });
  } catch (error) {
    await t.rollback();
    console.error("Delete user error:", error);
    res.status(500).json({ error: "Delete failed" });
  }
};

// ---------------------------------------------------------------------
// VERIFY EMAIL
// ---------------------------------------------------------------------
exports.verifyEmail = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: "Email and OTP required" });

    const user = await User.findOne({ where: { email }, transaction: t });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.emailVerified) return res.status(400).json({ message: "Already verified" });
    if (!user.otp || new Date() > user.otpExpiresAt) return res.status(400).json({ error: "OTP expired" });

    const valid = await bcrypt.compare(otp, user.otp);
    if (!valid) return res.status(400).json({ error: "Invalid OTP" });

    await sequelize.query(
      `UPDATE Users SET emailVerified = true, otp = NULL, otpExpiresAt = NULL WHERE email = :email`,
      { replacements: { email }, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    await t.commit();
    res.json({ message: "Email verified" });
  } catch (error) {
    await t.rollback();
    console.error("Verify email error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
};

// ---------------------------------------------------------------------
// FORGOT / RESET PASSWORD (unchanged logic, uses raw SQL)
// ---------------------------------------------------------------------
exports.forgotPassword = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const user = await User.findOne({ where: { email }, transaction: t });
    if (!user) return res.status(404).json({ error: "User not found" });

    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await sequelize.query(
      `UPDATE Users SET otp = :otp, otpExpiresAt = :otpExpiresAt WHERE email = :email`,
      { replacements: { otp: hashedOTP, otpExpiresAt, email }, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    await sendMail({
      to: email,
      subject: "Password Reset OTP",
      html: `<p>Your OTP: <strong>${otp}</strong> (10 mins)</p>`,
    });

    await t.commit();
    res.json({ message: "OTP sent" });
  } catch (error) {
    await t.rollback();
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Failed" });
  }
};

exports.resetPassword = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { email, otp, password } = req.body;
    if (!email || !otp || !password) return res.status(400).json({ error: "All fields required" });
    if (password.length < 8) return res.status(400).json({ error: "Password too short" });

    const user = await User.findOne({ where: { email }, transaction: t });
    if (!user || !user.otp || new Date() > user.otpExpiresAt) return res.status(400).json({ error: "Invalid/expired OTP" });

    const valid = await bcrypt.compare(otp, user.otp);
    if (!valid) return res.status(400).json({ error: "Invalid OTP" });

    const hashed = await bcrypt.hash(password, 10);
    await sequelize.query(
      `UPDATE Users SET password = :password, otp = NULL, otpExpiresAt = NULL WHERE email = :email`,
      { replacements: { password: hashed, email }, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    await t.commit();
    res.json({ message: "Password reset" });
  } catch (error) {
    await t.rollback();
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Reset failed" });
  }
};

// ---------------------------------------------------------------------
// RESEND VERIFICATION
// ---------------------------------------------------------------------
exports.resendVerification = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const user = await User.findByPk(req.user.id, { transaction: t });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.emailVerified) return res.status(400).json({ message: "Already verified" });

    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await sequelize.query(
      `UPDATE Users SET otp = :otp, otpExpiresAt = :otpExpiresAt WHERE id = :id`,
      { replacements: { otp: hashedOTP, otpExpiresAt, id: req.user.id }, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    await sendMail({
      to: user.email,
      subject: "Verify Email",
      html: `<p>OTP: <strong>${otp}</strong> (10 mins)</p>`,
    });

    await t.commit();
    res.json({ message: "OTP resent" });
  } catch (error) {
    await t.rollback();
    console.error("Resend OTP error:", error);
    res.status(500).json({ error: "Failed" });
  }
};
