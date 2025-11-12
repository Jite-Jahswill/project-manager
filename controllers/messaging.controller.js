// controllers/messaging.controller.js
const {
  Conversation,
  Participant,
  Message,
  User,
  sequelize,
  Op,
} = require("../models");
const { io } = require("../socket/io.server"); // Export io from io.server.js

// Helper: Format conversation with fullName
const formatConversation = (conv) => {
  const json = conv.toJSON();
  json.participants = json.participants.map((u) => ({
    ...u,
    fullName: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
  }));
  return json;
};

// ────────────────────────────────────────
// 1. Get or Create Private Chat (1-to-1)
// ────────────────────────────────────────
exports.getPrivateChat = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.id;
    const { recipientId } = req.params;

    if (parseInt(userId) === parseInt(recipientId)) {
      await t.rollback();
      return res.status(400).json({ error: "Cannot chat with yourself" });
    }

    // Find existing direct conversation
    const existing = await Conversation.findOne({
      where: { type: "direct" },
      include: [{
        model: User,
        as: "participants",
        attributes: ["id"],
        through: { attributes: [] },
        where: { id: { [Op.in]: [userId, recipientId] } },
      }],
      group: ['Conversation.id'],
      having: sequelize.literal(`COUNT(DISTINCT "participants"."id") = 2`),
      transaction: t,
    });

    if (existing) {
      await t.commit();
      const full = await Conversation.findByPk(existing.id, {
        include: [{
          model: User,
          as: "participants",
          attributes: ["id", "firstName", "lastName", "email"],
        }],
      });
      return res.json(formatConversation(full));
    }

    // Create new
    const conversation = await Conversation.create(
      { type: "direct", createdBy: userId },
      { transaction: t }
    );

    await Participant.bulkCreate([
      { conversationId: conversation.id, userId },
      { conversationId: conversation.id, userId: recipientId },
    ], { transaction: t });

    await t.commit();

    const full = await Conversation.findByPk(conversation.id, {
      include: [{
        model: User,
        as: "participants",
        attributes: ["id", "firstName", "lastName", "email"],
      }],
    });

    return res.status(201).json(formatConversation(full));
  } catch (err) {
    await t.rollback();
    console.error("getPrivateChat error:", err);
    return res.status(500).json({ error: "Failed to get private chat" });
  }
};

// ────────────────────────────────────────
// 2. Create Group Chat
// ────────────────────────────────────────
exports.createGroupChat = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { name, participantIds } = req.body;
    const creatorId = req.user.id;

    if (!name || !Array.isArray(participantIds) || participantIds.length < 2) {
      await t.rollback();
      return res.status(400).json({ error: "Name and at least 2 participants required" });
    }

    const allIds = [...new Set([creatorId, ...participantIds])];
    if (allIds.length < 3) {
      await t.rollback();
      return res.status(400).json({ error: "Group must have at least 3 members (including you)" });
    }

    const conversation = await Conversation.create({
      type: "group",
      name,
      createdBy: creatorId,
    }, { transaction: t });

    const participants = allIds.map(userId => ({
      conversationId: conversation.id,
      userId,
    }));

    await Participant.bulkCreate(participants, { transaction: t });
    await t.commit();

    const full = await Conversation.findByPk(conversation.id, {
      include: [{
        model: User,
        as: "participants",
        attributes: ["id", "firstName", "lastName", "email"],
      }],
    });

    // Notify via socket
    io.to(`user:${creatorId}`).emit("conversationCreated", formatConversation(full));

    return res.status(201).json(formatConversation(full));
  } catch (err) {
    await t.rollback();
    console.error("createGroupChat error:", err);
    return res.status(500).json({ error: "Failed to create group" });
  }
};

// ────────────────────────────────────────
// 3. Get All Conversations (Private + Group)
// ────────────────────────────────────────
exports.getAllConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const conversations = await Conversation.findAll({
      include: [{
        model: User,
        as: "participants",
        attributes: ["id", "firstName", "lastName", "email"],
        through: { attributes: [] },
        where: { id: userId },
      }],
      order: [["updatedAt", "DESC"]],
    });

    const formatted = conversations.map(formatConversation);
    return res.json(formatted);
  } catch (err) {
    console.error("getAllConversations error:", err);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
};

// ────────────────────────────────────────
// 4. Send Message
// ────────────────────────────────────────
exports.sendMessage = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { conversationId } = req.params;
    const { content, type = "text" } = req.body;
    const senderId = req.user.id;

    const participant = await Participant.findOne({
      where: { conversationId, userId: senderId },
      transaction: t,
    });
    if (!participant) {
      await t.rollback();
      return res.status(403).json({ error: "Not part of this conversation" });
    }

    const conversation = await Conversation.findByPk(conversationId, { transaction: t });
    let receiverId = null;

    if (conversation.type === "direct") {
      const other = await Participant.findOne({
        where: { conversationId, userId: { [Op.ne]: senderId } },
        transaction: t,
      });
      receiverId = other?.userId || null;
    }

    const message = await Message.create({
      conversationId,
      senderId,
      receiverId,
      content,
      type,
      isRead: false,
    }, { transaction: t });

    await t.commit();

    const populated = await Message.findByPk(message.id, {
      include: [
        { model: User, as: "sender", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "receiver", attributes: ["id", "firstName", "lastName", "email"] },
      ],
    });

    const msgData = populated.toJSON();

    // Emit to room
    io.to(`conversation:${conversationId}`).emit("newMessage", msgData);

    // Push to receiver
    if (receiverId) {
      io.to(`user:${receiverId}`).emit("newMessageNotification", {
        conversationId,
        message: msgData,
      });
    }

    return res.status(201).json(msgData);
  } catch (err) {
    await t.rollback();
    console.error("sendMessage error:", err);
    return res.status(500).json({ error: "Failed to send message" });
  }
};

// ────────────────────────────────────────
// 5. Get Messages + Mark as Read
// ────────────────────────────────────────
exports.getAllMessages = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const participant = await Participant.findOne({
      where: { conversationId, userId },
      transaction: t,
    });
    if (!participant) {
      await t.rollback();
      return res.status(403).json({ error: "Not in conversation" });
    }

    // Mark as read
    await Message.update(
      { isRead: true },
      {
        where: {
          conversationId,
          receiverId: userId,
          senderId: { [Op.ne]: userId },
          isRead: false,
        },
        transaction: t,
      }
    );

    const messages = await Message.findAll({
      where: { conversationId },
      include: [
        { model: User, as: "sender", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "receiver", attributes: ["id", "firstName", "lastName", "email"] },
      ],
      order: [["createdAt", "ASC"]],
      transaction: t,
    });

    await t.commit();

    // Emit read receipt
    const readIds = messages
      .filter(m => m.receiverId === userId && m.senderId !== userId && m.isRead)
      .map(m => m.id);

    if (readIds.length > 0) {
      io.to(`conversation:${conversationId}`).emit("messagesRead", {
        userId,
        messageIds: readIds,
      });
    }

    return res.json(messages);
  } catch (err) {
    await t.rollback();
    console.error("getAllMessages error:", err);
    return res.status(500).json({ error: "Failed to fetch messages" });
  }
};

// ────────────────────────────────────────
// 6. Edit Message
// ────────────────────────────────────────
exports.editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    const message = await Message.findByPk(messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.senderId !== userId) return res.status(403).json({ error: "Not your message" });

    await message.update({ content, isEdited: true });

    io.to(`conversation:${message.conversationId}`).emit("messageUpdated", {
      messageId,
      content,
      isEdited: true,
    });

    return res.json({ message: "Message updated", data: message });
  } catch (err) {
    console.error("editMessage error:", err);
    return res.status(500).json({ error: "Failed to edit message" });
  }
};

// ────────────────────────────────────────
// 7. Delete Message (Soft)
// ────────────────────────────────────────
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const message = await Message.findByPk(messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.senderId !== userId) return res.status(403).json({ error: "Not your message" });

    await message.update({ isDeleted: true, content: null });

    io.to(`conversation:${message.conversationId}`).emit("messageDeleted", { messageId });

    return res.json({ message: "Message deleted" });
  } catch (err) {
    console.error("deleteMessage error:", err);
    return res.status(500).json({ error: "Failed to delete message" });
  }
};

// ────────────────────────────────────────
// 8. Add Member to Group
// ────────────────────────────────────────
exports.addGroupMember = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId } = req.body;

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation || conversation.type !== "group")
      return res.status(400).json({ error: "Not a group" });

    const exists = await Participant.findOne({ where: { conversationId, userId } });
    if (exists) return res.status(400).json({ error: "User already in group" });

    await Participant.create({ conversationId, userId });

    io.to(`conversation:${conversationId}`).emit("participantAdded", { userId });

    return res.json({ message: "Member added" });
  } catch (err) {
    console.error("addGroupMember error:", err);
    return res.status(500).json({ error: "Failed to add member" });
  }
};

// ────────────────────────────────────────
// 9. Leave Conversation
// ────────────────────────────────────────
exports.leaveConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const participant = await Participant.findOne({ where: { conversationId, userId } });
    if (!participant) return res.status(404).json({ error: "Not in conversation" });

    await participant.destroy();

    io.to(`conversation:${conversationId}`).emit("participantRemoved", { userId });

    return res.json({ message: "Left conversation" });
  } catch (err) {
    console.error("leaveConversation error:", err);
    return res.status(500).json({ error: "Failed to leave" });
  }
};
