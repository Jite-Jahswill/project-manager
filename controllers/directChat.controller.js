// directChat.controller.js
const { DirectChat, User, sequelize } = require("../models");
const { Op } = require("sequelize");

// Helper
const formatUser = (u) => ({
  id: u.id,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  fullName: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
});

// 1️⃣ Get chat history between two users & mark as read
exports.getChatHistory = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { user1, user2 } = req.params;

    const messages = await DirectChat.findAll({
      where: {
        [Op.or]: [
          { senderId: user1, receiverId: user2 },
          { senderId: user2, receiverId: user1 },
        ],
      },
      include: [
        { model: User, as: "sender", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "receiver", attributes: ["id", "firstName", "lastName", "email"] },
      ],
      order: [["createdAt", "ASC"]],
      transaction: t,
    });

    // Mark unread messages as read for the requesting user
    await DirectChat.update(
      { isRead: true },
      {
        where: { receiverId: req.user.id, isRead: false, senderId: { [Op.in]: [user1, user2] } },
        transaction: t,
      }
    );

    await t.commit();
    res.json(messages);
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ error: "Failed to fetch chat history", details: err.message });
  }
};

// 2️⃣ Send a message (text or file)
exports.sendMessage = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const senderId = req.user.id;
    const { receiverId, content } = req.body;

    if (!receiverId) return res.status(400).json({ error: "receiverId required" });
    if (!content && (!req.uploadedFiles || req.uploadedFiles.length === 0)) {
      return res.status(400).json({ error: "Message content or file required" });
    }

    let type = "text";
    let finalContent = content;

    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const file = req.uploadedFiles[0];
      finalContent = file.firebaseUrl;
      type = file.mimetype.startsWith("image/") ? "image" : "file";
    }

    const message = await DirectChat.create(
      { senderId, receiverId, content: finalContent, type },
      { transaction: t }
    );

    const fullMessage = await DirectChat.findByPk(message.id, {
      include: [
        { model: User, as: "sender", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "receiver", attributes: ["id", "firstName", "lastName", "email"] },
      ],
      transaction: t,
    });

    await t.commit();
    res.status(201).json(fullMessage);
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ error: "Failed to send message", details: err.message });
  }
};

// 3️⃣ Edit a message
exports.editMessage = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;
  try {
    const msg = await DirectChat.findByPk(messageId);
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.senderId !== userId) return res.status(403).json({ error: "Cannot edit others' messages" });
    if (msg.isDeleted) return res.status(400).json({ error: "Message deleted" });

    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "Content required" });

    msg.content = content;
    msg.isEdited = true;
    await msg.save();

    res.json(msg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to edit message", details: err.message });
  }
};

// 4️⃣ Delete a message
exports.deleteMessage = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;
  try {
    const msg = await DirectChat.findByPk(messageId);
    if (!msg) return res.status(404).json({ error: "Message not found" });
    if (msg.senderId !== userId && msg.receiverId !== userId) {
      return res.status(403).json({ error: "Cannot delete others' messages" });
    }

    msg.isDeleted = true;
    await msg.save();
    res.json({ message: "Message deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete message", details: err.message });
  }
};
