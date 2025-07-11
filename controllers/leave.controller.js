const db = require("../models");
const Leave = db.Leave;
const User = db.User;
const sendMail = require("../utils/mailer");

exports.createLeave = async (req, res) => {
  try {
    const { startDate, endDate, reason } = req.body;

    // Validate input
    if (!startDate || !endDate || !reason) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Fetch user data using req.user.id
    const user = await User.findByPk(req.user.id, {
      attributes: ["firstName", "lastName", "email"],
    });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Create new leave entry
    const newLeave = await Leave.create({
      userId: req.user.id,
      startDate,
      endDate,
      reason,
    });

    // Notify admins and managers
    const admins = await User.findAll({
      where: { role: ["admin", "manager"] },
      attributes: ["email"],
    });

    const adminEmails = admins.map((admin) => admin.email).filter(Boolean);

    if (adminEmails.length === 0) {
      console.warn("No admin or manager emails found. No notifications sent.", {
        userId: req.user.id,
        timestamp: new Date().toISOString(),
      });
      return res.status(201).json({
        message: "Leave created, but no notifications sent",
        leave: newLeave,
      });
    }

    // Send notification email
    await sendMail({
      to: adminEmails,
      subject: "New Leave Request Submitted",
      html: `
        <p>Hello,</p>
        <p><strong>${user.firstName} ${user.lastName}</strong> has submitted a leave request from <strong>${startDate}</strong> to <strong>${endDate}</strong>.</p>
        <p>Reason: ${reason}</p>
        <p>Visit the dashboard to review and take action.</p>
        <p>Best,<br>Team</p>
      `,
    });

    res
      .status(201)
      .json({ message: "Leave created successfully", leave: newLeave });
  } catch (error) {
    console.error("Error creating leave:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Error creating leave", details: error.message });
  }
};

exports.getAllLeaves = async (req, res) => {
  try {
    const { status, userId, startDate, endDate } = req.query;

    const whereClause = {};

    // Role-based visibility
    if (req.user.role === "staff") {
      whereClause.userId = req.user.id;
    }

    // Optional filters
    if (status) {
      whereClause.status = status;
    }

    if (userId && ["admin", "manager"].includes(req.user.role)) {
      whereClause.userId = userId; // Admin or manager can search by userId
    }

    if (startDate) {
      whereClause.startDate = {
        [db.Sequelize.Op.gte]: new Date(startDate),
      };
    }

    if (endDate) {
      whereClause.endDate = {
        [db.Sequelize.Op.lte]: new Date(endDate),
      };
    }

    const leaves = await Leave.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    res.status(200).json(leaves);
  } catch (error) {
    console.error("Error fetching leaves:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      role: req.user?.role,
      query: req.query,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Error fetching leaves", details: error.message });
  }
};

exports.getLeaveById = async (req, res) => {
  try {
    const { id } = req.params;

    const leave = await Leave.findByPk(id, {
      include: {
        model: User,
        attributes: ["id", "firstName", "lastName", "email"],
      },
    });

    if (!leave) {
      return res.status(404).json({ message: "Leave not found" });
    }

    // Restrict staff to their own leaves
    if (req.user.role === "staff" && leave.userId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Unauthorized to view this leave" });
    }

    res.status(200).json(leave);
  } catch (error) {
    console.error("Error retrieving leave:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      leaveId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Error retrieving leave", details: error.message });
  }
};

exports.updateLeaveStatus = async (req, res) => {
  try {
    if (!["admin", "manager"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Only admins or managers can update leave status" });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res
        .status(400)
        .json({ message: "Status must be 'approved' or 'rejected'" });
    }

    const leave = await Leave.findByPk(id, {
      include: {
        model: User,
        attributes: ["email", "firstName", "lastName"],
      },
    });

    if (!leave) {
      return res.status(404).json({ message: "Leave not found" });
    }

    await leave.update({ status });

    const user = leave.User;
    await sendMail({
      to: user.email,
      subject: `Your Leave Request has been ${status.toUpperCase()}`,
      html: `
        <p>Hi ${user.firstName},</p>
        <p>Your leave request from <strong>${
          leave.startDate
        }</strong> to <strong>${
        leave.endDate
      }</strong> has been <strong>${status}</strong>.</p>
        <p>${
          status === "approved"
            ? "We hope you enjoy your time off. Take care and come back refreshed!"
            : "We understand this might be disappointing. Feel free to reach out if you have questions or want to reschedule."
        }</p>
        <p>Best,<br>Team</p>
      `,
    });

    res
      .status(200)
      .json({ message: "Leave status updated successfully", leave });
  } catch (error) {
    console.error("Error updating leave status:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      leaveId: req.params.id,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Error updating leave status", details: error.message });
  }
};

exports.deleteLeave = async (req, res) => {
  try {
    const { id } = req.params;

    const leave = await Leave.findByPk(id);

    if (!leave) {
      return res.status(404).json({ message: "Leave not found" });
    }

    // Restrict staff to their own leaves
    if (req.user.role === "staff" && leave.userId !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Unauthorized to delete this leave" });
    }

    await leave.destroy();

    res.status(200).json({ message: "Leave deleted" });
  } catch (error) {
    console.error("Error deleting leave:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      leaveId: req.params.id,
      timestamp: new Date().toISOString(),
    });
    res
      .status(500)
      .json({ message: "Error deleting leave", details: error.message });
  }
};
