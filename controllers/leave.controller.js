const db = require("../models");
const Leave = db.Leave;
const User = db.User;
const sendMail = require("../utils/mailer");

module.exports = {
  // Create a new leave request (Retains admin/manager notifications)
  async createLeave(req, res) {
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
        status: "pending", // Default status
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Notify admins and managers
      const admins = await User.findAll({
        where: { role: ["superadmin", "admin"] },
        attributes: ["email"],
      });

      const adminEmails = admins.map((admin) => admin.email).filter(Boolean);

      if (adminEmails.length === 0) {
        console.warn("No superadmin or admin emails found. No notifications sent.", {
          userId: req.user.id,
          timestamp: new Date().toISOString(),
        });
        return res.status(201).json({
          message: "Leave created, but no notifications sent",
          leave: {
            id: newLeave.id,
            userId: newLeave.userId,
            startDate: newLeave.startDate,
            endDate: newLeave.endDate,
            reason: newLeave.reason,
            status: newLeave.status,
            createdAt: newLeave.createdAt,
            updatedAt: newLeave.updatedAt,
            User: user,
          },
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

      res.status(201).json({
        message: "Leave created successfully",
        leave: {
          id: newLeave.id,
          userId: newLeave.userId,
          startDate: newLeave.startDate,
          endDate: newLeave.endDate,
          reason: newLeave.reason,
          status: newLeave.status,
          createdAt: newLeave.createdAt,
          updatedAt: newLeave.updatedAt,
          User: user,
        },
      });
    } catch (error) {
      console.error("Error creating leave:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error creating leave", details: error.message });
    }
  },

  // Get all leaves (No role restrictions, fetch all with filters)
  async getAllLeaves(req, res) {
    try {
      const { status, userId, startDate, endDate, page = 1, limit = 20 } = req.query;

      const whereClause = {};

      // Optional filters
      if (userId) {
        whereClause.userId = userId;
      }
      if (status) {
        whereClause.status = status;
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

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const { count, rows } = await Leave.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: User,
            attributes: ["id", "firstName", "lastName", "email"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: parseInt(limit),
        offset,
      });

      const totalPages = Math.ceil(count / limit);

      res.status(200).json({
        leaves: rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Error fetching leaves:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error fetching leaves", details: error.message });
    }
  },

  // Get leaves by user ID (New endpoint, no role restrictions)
  async getLeavesByUserId(req, res) {
    try {
      const { userId } = req.params;
      const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

      const whereClause = { userId: parseInt(userId) };

      if (status) {
        whereClause.status = status;
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

      const offset = (parseInt(page) - 1) * parseInt(limit);
      const { count, rows } = await Leave.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: User,
            attributes: ["id", "firstName", "lastName", "email"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: parseInt(limit),
        offset,
      });

      if (count === 0) {
        return res.status(404).json({ message: "No leaves found for this user" });
      }

      const totalPages = Math.ceil(count / limit);

      res.status(200).json({
        leaves: rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Error fetching leaves by user ID:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        queryUserId: req.params.userId,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error fetching leaves by user ID", details: error.message });
    }
  },

  // Get a single leave by ID (No role restrictions)
  async getLeaveById(req, res) {
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

      res.status(200).json({ leave });
    } catch (error) {
      console.error("Error retrieving leave:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        leaveId: req.params.id,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error retrieving leave", details: error.message });
    }
  },

  // Update a leave request (No role restrictions)
  async updateLeave(req, res) {
    try {
      const { id } = req.params;
      const { startDate, endDate, reason } = req.body;

      const leave = await Leave.findByPk(id, {
        include: {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
        },
      });

      if (!leave) {
        return res.status(404).json({ message: "Leave not found" });
      }

      // Prevent updates if status is not pending
      if (leave.status !== "pending") {
        return res.status(400).json({ message: "Cannot update a leave that is not pending" });
      }

      // Validate input
      if (!startDate && !endDate && !reason) {
        return res.status(400).json({ message: "At least one field (startDate, endDate, reason) is required" });
      }

      // Build raw SQL query
      const updates = [];
      if (startDate) updates.push(`startDate = '${new Date(startDate).toISOString().replace(/'/g, "\\'")}'`);
      if (endDate) updates.push(`endDate = '${new Date(endDate).toISOString().replace(/'/g, "\\'")}'`);
      if (reason) updates.push(`reason = '${reason.replace(/'/g, "\\'")}'`);
      updates.push(`updatedAt = NOW()`);

      if (updates.length > 1 || (updates.length === 1 && !updates.includes(`updatedAt = NOW()`))) {
        const query = `
          UPDATE Leaves
          SET ${updates.join(", ")}
          WHERE id = ${parseInt(id)}
        `;
        await db.sequelize.query(query, { type: db.sequelize.QueryTypes.UPDATE });
      }

      // Notify admins and managers
      const admins = await User.findAll({
        where: { role: ["superadmin", "admin"] },
        attributes: ["email"],
      });

      const adminEmails = admins.map((admin) => admin.email).filter(Boolean);

      if (adminEmails.length > 0) {
        await sendMail({
          to: adminEmails,
          subject: "Leave Request Updated",
          html: `
            <p>Hello,</p>
            <p><strong>${leave.User.firstName} ${leave.User.lastName}</strong> has updated their leave request (ID: ${id}) from <strong>${startDate || leave.startDate}</strong> to <strong>${endDate || leave.endDate}</strong>.</p>
            <p>Reason: ${reason || leave.reason}</p>
            <p>Visit the dashboard to review and take action.</p>
            <p>Best,<br>Team</p>
          `,
        });
      }

      const updatedLeave = await Leave.findByPk(id, {
        include: {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
        },
      });

      res.status(200).json({
        message: "Leave updated successfully",
        leave: updatedLeave,
      });
    } catch (error) {
      console.error("Error updating leave:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        leaveId: req.params.id,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error updating leave", details: error.message });
    }
  },

  // Update leave status (No role restrictions)
  async updateLeaveStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Status must be 'approved' or 'rejected'" });
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

      await Leave.update({ status, updatedAt: new Date() }, { where: { id } });

      const user = leave.User;
      await sendMail({
        to: user.email,
        subject: `Your Leave Request has been ${status.toUpperCase()}`,
        html: `
          <p>Hi ${user.firstName},</p>
          <p>Your leave request from <strong>${leave.startDate}</strong> to <strong>${leave.endDate}</strong> has been <strong>${status}</strong>.</p>
          <p>${
            status === "approved"
              ? "We hope you enjoy your time off. Take care and come back refreshed!"
              : "We understand this might be disappointing. Feel free to reach out if you have questions or want to reschedule."
          }</p>
          <p>Best,<br>Team</p>
        `,
      });

      const updatedLeave = await Leave.findByPk(id, {
        include: {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
        },
      });

      res.status(200).json({
        message: "Leave status updated successfully",
        leave: updatedLeave,
      });
    } catch (error) {
      console.error("Error updating leave status:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        leaveId: req.params.id,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error updating leave status", details: error.message });
    }
  },

  // Delete a leave request (No role restrictions)
  async deleteLeave(req, res) {
    try {
      const { id } = req.params;

      const leave = await Leave.findByPk(id, {
        include: {
          model: User,
          attributes: ["email", "firstName", "lastName"],
        },
      });

      if (!leave) {
        return res.status(404).json({ message: "Leave not found" });
      }

      await leave.destroy();

      await sendMail({
        to: leave.User.email,
        subject: "Your Leave Request has been Deleted",
        html: `
          <p>Hi ${leave.User.firstName},</p>
          <p>Your leave request from <strong>${leave.startDate}</strong> to <strong>${leave.endDate}</strong> has been deleted.</p>
          <p>Please contact us if you have any questions.</p>
          <p>Best,<br>Team</p>
        `,
      });

      res.status(200).json({ message: "Leave deleted successfully" });
    } catch (error) {
      console.error("Error deleting leave:", {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        leaveId: req.params.id,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Error deleting leave", details: error.message });
    }
  },
};
