const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User } = require("../models");
const fs = require("fs");
const path = require("path");
const sendMail = require("../utils/mailer");

// Register User
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;
    const image = req.file ? req.file.filename : null;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (role && !["admin", "manager", "staff"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role: role || "staff",
      image,
    });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    const verifyLink = `${process.env.FRONTEND_URL}/api/auth/verify-email/${token}`;

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

    res.status(201).json({
      message: "User registered",
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        image: user.image,
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

    res.json({ message: "Login successful", token });
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
    const users = await User.findAll({ attributes: { exclude: ["password"] } });
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
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ["password"] },
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
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
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { firstName, lastName, email } = req.body;
    const image = req.file ? req.file.filename : user.image;

    // Delete old image if a new one is uploaded
    if (req.file && user.image) {
      const oldImagePath = path.join(__dirname, "../Uploads", user.image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }

    await user.update({
      firstName: firstName ?? user.firstName,
      lastName: lastName ?? user.lastName,
      email: email ?? user.email,
      image,
    });

    res.json({
      message: "User updated successfully",
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        image: user.image,
        fullName: user.fullName,
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
    const { role } = req.body;

    if (!["admin", "manager", "staff"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const user = await User.findByPk(req.params.id);
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

    res.json({ message: "User role updated", user });
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
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.image) {
      const imagePath = path.join(__dirname, "../Uploads", user.image);
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.emailVerified = true;
    await user.save();

    res.json({ message: "Email verified successfully" });
  } catch (error) {
    console.error("Verify email error:", {
      message: error.message,
      stack: error.stack,
      token: req.params.token,
      timestamp: new Date().toISOString(),
    });
    res
      .status(400)
      .json({ error: "Invalid or expired token", details: error.message });
  }
};

// Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
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

    res.json({ message: "Reset link sent to email" });
  } catch (error) {
    console.error("Forgot password error:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ error: "Error sending reset email", details: error.message });
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
      .status(400)
      .json({ error: "Invalid or expired token", details: error.message });
  }
};
