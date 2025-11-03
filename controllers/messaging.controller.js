// controllers/messaging.controller.js
const { Conversation, Message, Participant, User } = require("../models");
const { Op } = require("sequelize");

// Create or get 1:1 conversation
exports.createOrGetConversation = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    if (parseInt(userId) === currentUserId) {
      return res.status(400).json({ error: "Cannot chat with yourself" });
    }

    // Find existing 1:1 conversation between these two users
    const existingConversation = await Conversation.findOne({
      where: { isGroup: false, name: null },
      include: [
        {
          model: User,
          as: "participants",
          where: { id: { [Op.in]: [currentUserId, parseInt(userId)] } },
          through: { attributes: [] },
        },
      ],
      group: ['Conversation.id'],
      having: sequelize.literal(`COUNT(DISTINCT "participants"."id") = 2`),
      transaction: t,
    });

    let conversation;

    if (existingConversation) {
      conversation = existingConversation;
    } else {
      // Create new conversation
      conversation = await Conversation.create(
        { isGroup: false, type: "direct" },
        { transaction: t }
      );

      // Add both users
      await Participant.bulkCreate(
        [
          { conversationId: conversation.id, userId: currentUserId },
          { conversationId: conversation.id, userId: parseInt(userId) },
        ],
        { transaction: t }
      );
    }

    await t.commit();

    // Return full conversation with participants and recent messages
    const fullConv = await Conversation.findByPk(conversation.id, {
      include: [
        {
          model: User,
          as: "participants",
          attributes: ["id", "firstName", "lastName", "email"],
          through: { attributes: [] },
        },
        {
          model: Message,
          limit: 50,
          order: [["createdAt", "DESC"]],
          include: [{ model: User, as: "sender", attributes: ["id", "firstName", "lastName"] }],
        },
      ],
    });

    res.json({ conversation: fullConv });
  } catch (err) {
    await t.rollback();
    console.error("Create conversation error:", err);
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: "Conversation already exists" });
    }
    res.status(500).json({ error: "Failed to create/get conversation" });
  }
};

exports.getAllMessages = async (req, res) => {
  try {
    const { page = 1, limit = 50, search = "" } = req.query;
    const offset = (page - 1) * limit;

    // Build where clause for search (optional)
    const where = search
      ? {
          [Op.or]: [
            { content: { [Op.like]: `%${search}%` } },
            { "$sender.firstName$": { [Op.like]: `%${search}%` } },
            { "$sender.lastName$": { [Op.like]: `%${search}%` } },
            { "$conversation.name$": { [Op.like]: `%${search}%` } },
          ],
        }
      : {};

    const { count, rows: messages } = await Message.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: "sender",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        {
          model: Conversation,
          attributes: ["id", "name", "isGroup", "type"],
          include: [
            {
              model: User,
              as: "participants",
              attributes: ["id", "firstName", "lastName"],
              through: { attributes: [] },
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset,
      distinct: true, // important for count with includes
    });

    res.json({
      messages,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Get all messages error:", err);
    res.status(500).json({ error: "Failed to fetch all messages" });
  }
};

// Create group conversation
exports.createGroupConversation = async (req, res) => {
  try {
    const { name, userIds } = req.body; // userIds = [1, 2, 3]
    const currentUserId = req.user.id;

    if (!name || !Array.isArray(userIds) || userIds.length < 2) {
      return res.status(400).json({ error: "Name and at least 2 user IDs required" });
    }

    // Create conversation
    const conversation = await Conversation.create({
      name: `${name} (${userIds.length + 1} members)`,
      isGroup: true,
      type: "group",
    });

    // Add participants (current user + selected)
    const participants = [currentUserId, ...userIds].map((userId) => ({
      conversationId: conversation.id,
      userId,
    }));

    await Participant.bulkCreate(participants);

    res.status(201).json({ conversation });
  } catch (err) {
    console.error("Create group error:", err);
    res.status(500).json({ error: "Failed to create group" });
  }
};

// Send message
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId, content, type = "text" } = req.body;
    const senderId = req.user.id;

    const message = await Message.create({
      content,
      type,
      conversationId,
      senderId,
    });

    // Emit real-time (see Socket.IO below)
    io?.to(`conversation:${conversationId}`).emit("newMessage", {
      message,
      sender: { id: senderId, name: req.user.name },
    });

    res.json({ message });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
};

// Get messages for conversation
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.body;

    const messages = await Message.findAll({
      where: { conversationId },
      include: [{ model: User, as: "sender", attributes: ["id", "firstName", "lastName"] }],
      order: [["id", "DESC"]],
      limit,
      offset: (page - 1) * limit,
    });

    res.json({ messages: messages.reverse() }); // reverse to show newest first
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};

// Update (edit) message
exports.updateMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const senderId = req.user.id;

    const message = await Message.findOne({
      where: { id: messageId, senderId },
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found or unauthorized" });
    }

    await message.update({ content, isEdited: true });

    // Emit real-time
    io?.to(`conversation:${message.conversationId}`).emit("messageUpdated", {
      messageId,
      content,
      isEdited: true,
    });

    res.json({ message });
  } catch (err) {
    console.error("Update message error:", err);
    res.status(500).json({ error: "Failed to update message" });
  }
};

// Delete message
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const senderId = req.user.id;

    const message = await Message.findOne({
      where: { id: messageId, senderId },
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found or unauthorized" });
    }

    await message.update({ isDeleted: true, content: "[Message deleted]" });

    // Emit real-time
    io?.to(`conversation:${message.conversationId}`).emit("messageDeleted", {
      messageId,
    });

    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("Delete message error:", err);
    res.status(500).json({ error: "Failed to delete message" });
  }
};

// Add participant to group
exports.addParticipant = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId } = req.body;

    await Participant.create({
      conversationId,
      userId,
    });

    // Emit real-time
    io?.to(`conversation:${conversationId}`).emit("participantAdded", {
      userId,
    });

    res.json({ message: "Added" });
  } catch (err) {
    console.error("Add participant error:", err);
    res.status(500).json({ error: "Failed to add participant" });
  }
};

// Leave conversation
exports.leaveConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    await Participant.destroy({
      where: { conversationId, userId },
    });

    // Emit real-time
    io?.to(`conversation:${conversationId}`).emit("participantLeft", {
      userId,
    });

    res.json({ message: "Left" });
  } catch (err) {
    console.error("Leave conversation error:", err);
    res.status(500).json({ error: "Failed to leave" });
  }
};
