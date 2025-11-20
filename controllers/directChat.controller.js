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

// Get full chat history between two users
exports.getChatHistory = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const requestingUserId = req.user.id;
    const { user1, user2 } = req.params;

    // Ensure the requesting user is part of this conversation
    if (![parseInt(user1), parseInt(user2)].includes(requestingUserId)) {
      await t.rollback();
      return res.status(403).json({ error: "You are not part of this conversation" });
    }

    // Fetch all messages between the two users (both directions)
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
        where: {
          receiverId: requestingUserId,
          senderId: { [Op.in]: [user1, user2] },
          isRead: false,
        },
        transaction: t,
      }
    );

    await t.commit();

    // Format response: optional, you can include user info neatly
    const formatted = messages.map((m) => ({
      id: m.id,
      content: m.content,
      type: m.type,
      isRead: m.isRead,
      isEdited: m.isEdited,
      isDeleted: m.isDeleted,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      sender: formatUser(m.sender),
      receiver: formatUser(m.receiver),
    }));

    res.status(200).json(formatted);
  } catch (err) {
    await t.rollback();
    console.error("getChatHistory error:", err);
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

// FETCH UNREAD MESSAGE COUNT FOR CURRENT USER
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const unreadCount = await DirectChat.count({
      where: {
        receiverId: userId,
        isRead: false,
        isDeleted: false  // Don't count soft-deleted messages
      }
    });

    res.json({
      success: true,
      unreadCount: Number(unreadCount),
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error("getUnreadCount error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch unread count" 
    });
  }
};

// GET UNREAD COUNT FOR SPECIFIC CONVERSATION (e.g. badge on chat list)
exports.getConversationUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { otherUserId } = req.params;

    const count = await DirectChat.count({
      where: {
        senderId: otherUserId,
        receiverId: userId,
        isRead: false,
        isDeleted: false
      }
    });

    res.json({ unreadCount: Number(count) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversation unread count" });
  }
};
