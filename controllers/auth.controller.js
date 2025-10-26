const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, sequelize } = require("../models");
const sendMail = require("../utils/mailer");
const crypto = require("crypto");

// Generate a 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Register User
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, role, phoneNumber } = req.body;
    const image = req.uploadedFiles && req.uploadedFiles[0]?.firebaseUrl;

    if (!firstName || !lastName || !email || !phoneNumber || !image) {
      return res.status(400).json({ message: "firstName, lastName, email, phoneNumber, and image are required" });
    }

    if (role && !["admin", "manager", "staff"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const existingUserByEmail = await User.findOne({ where: { email } });
    if (existingUserByEmail) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const existingUserByPhone = await User.findOne({ where: { phoneNumber } });
    if (existingUserByPhone) {
      return res.status(409).json({ message: "Phone number already in use" });
    }

    // Auto-generate a secure password
    const autoPassword = crypto.randomBytes(8).toString("hex");
    const hashedPassword = await bcrypt.hash(autoPassword, 10);
    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const user = await User.create({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role: role || "staff",
      image,
      phoneNumber,
      emailVerified: false,
      otp: hashedOTP,
      otpExpiresAt,
    });

    await sendMail({
      to: user.email,
      subject: "Welcome! Verify Your Email and Set Up Your Account",
      html: `
        <p>Hello ${user.firstName},</p>
        <p>Your account has been created successfully. Below are your login details:</p>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Password:</strong> ${autoPassword}</p>
        <p><strong>OTP for email verification:</strong> ${otp}</p>
        <p>Please use the OTP to verify your email. The OTP expires in 10 minutes.</p>
        <p>For security, we recommend changing your password from your dashboard.</p>
        <p>Best,<br>Team</p>
      `,
    });

    res.status(201).json({
      message: "User registered successfully, OTP and password sent to email",
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        image: user.image,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Register user error:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ message: "Failed to register user", details: error.message });
  }
};

// Login User
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
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
        role: user.role,
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

// Get All Users
exports.getAllUsers = async (req, res) => {
  try {
    const { role, firstName, lastName, page = 1, limit = 20 } = req.query;
    const where = {};
    if (role) where.role = role;
    if (firstName) where.firstName = { [sequelize.Op.like]: `%${firstName}%` };
    if (lastName) where.lastName = { [sequelize.Op.like]: `%${lastName}%` };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: { exclude: ["password", "otp"] },
      limit: parseInt(limit),
      offset,
    });

    const totalPages = Math.ceil(count / limit);

    const users = rows.map(user => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
    }));

    res.json({
      users,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get all users error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to fetch users", details: error.message });
  }
};

// Get Single User
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const user = await User.findByPk(id, {
      attributes: { exclude: ["password", "otp"] },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
    });
  } catch (error) {
    console.error("Get user error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to fetch user", details: error.message });
  }
};

// Update User
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { firstName, lastName, email, phoneNumber } = req.body;
    const image = req.uploadedFiles && req.uploadedFiles[0]?.firebaseUrl ? req.uploadedFiles[0].firebaseUrl : user.image;

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ error: "Email already in use" });
      }
    }

    if (phoneNumber && phoneNumber !== user.phoneNumber) {
      const existingUser = await User.findOne({ where: { phoneNumber } });
      if (existingUser) {
        return res.status(409).json({ error: "Phone number already in use" });
      }
    }

    await sequelize.query(
      "UPDATE Users SET firstName = :firstName, lastName = :lastName, email = :email, phoneNumber = :phoneNumber, image = :image WHERE id = :id",
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
      }
    );

    const updatedUser = await User.findByPk(id, {
      attributes: { exclude: ["password", "otp"] },
    });

    res.json({
      message: "User updated successfully",
      user: {
        id: updatedUser.id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        phoneNumber: updatedUser.phoneNumber,
        image: updatedUser.image,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    console.error("Update user error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to update user", details: error.message });
  }
};

// Update User Role
exports.updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    if (!["admin", "manager", "staff"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await sequelize.query(
      "UPDATE Users SET role = :role WHERE id = :id",
      {
        replacements: { role, id },
        type: sequelize.QueryTypes.UPDATE,
      }
    );

    await sendMail({
      to: user.email,
      subject: "Your Role Was Updated",
      html: `
        <p>Hello ${user.firstName},</p>
        <p>Your role has been updated to <strong>${role}</strong>.</p>
        <p>Best,<br>Team</p>
      `,
    });

    const updatedUser = await User.findByPk(id, {
      attributes: { exclude: ["password", "otp"] },
    });

    res.json({
      message: "User role updated successfully",
      user: {
        id: updatedUser.id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    });
  } catch (error) {
    console.error("Update user role error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to update user role", details: error.message });
  }
};

// Delete User
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await user.destroy();
    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to delete user", details: error.message });
  }
};

// Verify Email
exports.verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: "Email already verified" });
    }

    if (!user.otp || !user.otpExpiresAt) {
      return res.status(400).json({ error: "No valid OTP found for this user" });
    }

    if (new Date() > user.otpExpiresAt) {
      return res.status(400).json({ error: "OTP has expired" });
    }

    const isValidOTP = await bcrypt.compare(otp, user.otp);
    if (!isValidOTP) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    await sequelize.query(
      "UPDATE Users SET emailVerified = true, otp = NULL, otpExpiresAt = NULL WHERE email = :email",
      {
        replacements: { email },
        type: sequelize.QueryTypes.UPDATE,
      }
    );

    res.json({
      message: "Email verified successfully",
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (error) {
    console.error("Verify email error:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to verify email", details: error.message });
  }
};

// Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await sequelize.query(
      "UPDATE Users SET otp = :otp, otpExpiresAt = :otpExpiresAt WHERE email = :email",
      {
        replacements: { otp: hashedOTP, otpExpiresAt, email },
        type: sequelize.QueryTypes.UPDATE,
      }
    );

    await sendMail({
      to: user.email,
      subject: "Reset Your Password with OTP",
      html: `
        <p>Hello ${user.firstName},</p>
        <p>Your OTP for password reset is: <strong>${otp}</strong></p>
        <p>This OTP expires in 10 minutes.</p>
        <p>Best,<br>Team</p>
      `,
    });

    res.json({ message: "Password reset OTP sent to email" });
  } catch (error) {
    console.error("Forgot password error:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to send reset OTP", details: error.message });
  }
};

// Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body;

    if (!email || !otp || !password) {
      return res.status(400).json({ error: "Email, OTP, and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.otp || !user.otpExpiresAt) {
      return res.status(400).json({ error: "No valid OTP found for this user" });
    }

    if (new Date() > user.otpExpiresAt) {
      return res.status(400).json({ error: "OTP has expired" });
    }

    const isValidOTP = await bcrypt.compare(otp, user.otp);
    if (!isValidOTP) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await sequelize.query(
      "UPDATE Users SET password = :password, otp = NULL, otpExpiresAt = NULL WHERE email = :email",
      {
        replacements: { password: hashedPassword, email },
        type: sequelize.QueryTypes.UPDATE,
      }
    );

    res.json({ message: "Password reset successful" });
  } catch (error) {
    console.error("Reset password error:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to reset password", details: error.message });
  }
};

// Resend Verification Email
exports.resendVerification = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: "Email already verified" });
    }

    const otp = generateOTP();
    const hashedOTP = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await sequelize.query(
      "UPDATE Users SET otp = :otp, otpExpiresAt = :otpExpiresAt WHERE id = :id",
      {
        replacements: { otp: hashedOTP, otpExpiresAt, id: req.user.id },
        type: sequelize.QueryTypes.UPDATE,
      }
    );

    await sendMail({
      to: user.email,
      subject: "Verify Your Email with OTP",
      html: `
        <p>Hello ${user.firstName},</p>
        <p>Your OTP for email verification is: <strong>${otp}</strong></p>
        <p>This OTP expires in 10 minutes.</p>
        <p>Best,<br>Team</p>
      `,
    });

    res.json({ message: "Verification OTP resent successfully" });
  } catch (error) {
    console.error("Resend verification email error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: "Failed to resend verification OTP", details: error.message });
  }
};
