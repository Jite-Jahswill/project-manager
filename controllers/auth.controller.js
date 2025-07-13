const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, sequelize } = require("../models");
const fs = require("fs");
const path = require("path");
const sendMail = require("../utils/mailer");

// Register User
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, role, phoneNumber } = req.body;
    const image = req.file ? `uploads/profiles/${req.file.filename}` : null;

    // Check for required fields
    if (!firstName || !lastName || !email || !password || !phoneNumber) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Validate role
    if (role && !["admin", "manager", "staff"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    // Check for existing user by email
    const existingUserByEmail = await User.findOne({ where: { email } });
    if (existingUserByEmail) {
      return res.status(409).json({ error: "Email already exists" });
    }

    // Check for existing user by phone number
    const existingUserByPhone = await User.findOne({ where: { phoneNumber } });
    if (existingUserByPhone) {
      return res.status(409).json({ error: "Phone number already in use" });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the user
    const user = await User.create({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role: role || "staff",
      image,
      phoneNumber,
      emailVerified: false,
    });

    // Generate JWT token for email verification
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    // Prepare email verification link
    const verifyLink = `${process.env.FRONTEND_URL}/api/auth/verify-email/${token}`;

    // Send verification email
    await sendMail({
      to: user.email,
      subject: "Verify Your Email",
      html: `
        <p>Hello ${user.firstName},</p>
        <p>Please verify your email by clicking the link below:</p>
        <a href="${verifyLink}">Verify Email</a>
        <p>This link expires in 24 hours.</p>
        <p>Best,<br>Team</p>
      `,
    });

    // Respond with user information
    res.status(201).json({
      message: "User registered successfully",
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
    res
      .status(500)
      .json({ error: "Failed to register user", details: error.message });
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
      { expiresIn: "1h" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
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
    const { role, firstName, lastName } = req.query;
    const where = {};
    if (role) where.role = role;
    if (firstName) where.firstName = { [sequelize.Op.like]: `%${firstName}%` };
    if (lastName) where.lastName = { [sequelize.Op.like]: `%${lastName}%` };

    const users = await User.findAll({
      where,
      attributes: { exclude: ["password"] },
    });
    res.json(users);
  } catch (error) {
    console.error("Get all users error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to fetch users", details: error.message });
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
      attributes: { exclude: ["password"] },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Authorization check
    if (req.user.id !== parseInt(id) && !["admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ message: "Unauthorized to view this user" });
    }

    res.json(user);
  } catch (error) {
    console.error("Get user error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to fetch user", details: error.message });
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

    // Authorization check
    if (req.user.id !== parseInt(id) && !["admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ message: "Unauthorized to update this user" });
    }

    const { firstName, lastName, email, phoneNumber } = req.body;
    const image = req.file ? `uploads/profiles/${req.file.filename}` : user.image;

    // Delete old image if a new one is uploaded
    if (req.file && user.image && user.image !== image) {
      const oldImagePath = path.join(__dirname, "../", user.image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }

    // Check for email uniqueness if email is being updated
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ error: "Email already in use" });
      }
    }

    // Check for phone number uniqueness if phoneNumber is being updated
    if (phoneNumber && phoneNumber !== user.phoneNumber) {
      const existingUser = await User.findOne({ where: { phoneNumber } });
      if (existingUser) {
        return res.status(409).json({ error: "Phone number already in use" });
      }
    }

    await user.update({
      firstName: firstName || user.firstName,
      lastName: lastName || user.lastName,
      email: email || user.email,
      phoneNumber: phoneNumber || user.phoneNumber,
      image,
    });

    res.json({
      message: "User updated successfully",
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
    console.error("Update user error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      targetUserId: req.params.id,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to update user", details: error.message });
  }
};

// Update User Role (Admin and manager only)
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

    await user.update({ role });

    await sendMail({
      to: user.email,
      subject: "Your Role Was Updated",
      html: `
        <p>Hello ${user.firstName},</p>
        <p>Your role has been updated to <strong>${role}</strong>.</p>
        <p>Best,<br>Team</p>
      `,
    });

    res.json({
      message: "User role updated successfully",
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
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
    res
      .status(500)
      .json({ error: "Failed to update user role", details: error.message });
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

    // Authorization check
    if (req.user.id !== parseInt(id) && !["admin", "manager"].includes(req.user.role)) {
      return res.status(403).json({ message: "Unauthorized to delete this user" });
    }

    if (user.image) {
      const imagePath = path.join(__dirname, "../", user.image);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
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
    res
      .status(500)
      .json({ error: "Failed to delete user", details: error.message });
  }
};

// Verify Email
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      console.error("JWT verification error:", {
        message: jwtError.message,
        stack: jwtError.stack,
        token,
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({ error: "Invalid or expired token", details: jwtError.message });
    }

    const user = await User.findByPk(decoded.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: "Email already verified" });
    }

    // Attempt to update emailVerified with a transaction to handle database errors
    await sequelize.transaction(async (t) => {
      user.emailVerified = true;
      await user.save({ transaction: t });
    });

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
      token: req.params.token,
      timestamp: new Date().toISOString(),
    });
    if (error.message.includes("Prepared statement needs to be re-prepared")) {
      // Attempt to reset the connection pool
      await sequelize.query("SET SESSION table_open_cache = 1000");
      return res.status(500).json({
        error: "Database error",
        details: "Prepared statement issue, please try again",
      });
    }
    res
      .status(500)
      .json({ error: "Failed to verify email", details: error.message });
  }
};

// Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    const resetLink = `${process.env.FRONTEND_URL}/api/auth/reset-password/${token}`;

    await sendMail({
      to: email,
      subject: "Password Reset",
      html: `
        <p>Hi ${user.firstName},</p>
        <p>Click the link below to reset your password:</p>
        <a href="${resetLink}">Reset Password</a>
        <p>This link expires in 15 minutes.</p>
        <p>Best,<br>Team</p>
      `,
    });

    res.json({ message: "Password reset email sent" });
  } catch (error) {
    console.error("Forgot password error:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to send reset email", details: error.message });
  }
};

// Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Password required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      console.error("JWT verification error:", {
        message: jwtError.message,
        stack: jwtError.stack,
        token,
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({ error: "Invalid or expired token", details: jwtError.message });
    }

    const user = await User.findByPk(decoded.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.password = await bcrypt.hash(password, 10);
    await user.save();

    res.json({ message: "Password reset successful" });
  } catch (error) {
    console.error("Reset password error:", {
      message: error.message,
      stack: error.stack,
      token: req.params.token,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to reset password", details: error.message });
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

    // Generate JWT token for email verification
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    // Prepare email verification link
    const verifyLink = `${process.env.FRONTEND_URL}/api/auth/verify-email/${token}`;

    // Send verification email
    await sendMail({
      to: user.email,
      subject: "Verify Your Email",
      html: `
        <p>Hello ${user.firstName},</p>
        <p>Please verify your email by clicking the link below:</p>
        <a href="${verifyLink}">Verify Email</a>
        <p>This link expires in 24 hours.</p>
        <p>Best,<br>Team</p>
      `,
    });

    res.json({ message: "Verification email resent successfully" });
  } catch (error) {
    console.error("Resend verification email error:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Failed to resend verification email", details: error.message });
  }
};
