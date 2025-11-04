const { Conversation, Message, Participant, User, sequelize } = require("../models");

// 🟢 Create or get direct chat
exports.startDirectChat = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const userId = req.user.id;
    const { recipientId } = req.params;

    // Prevent self-chat
    if (parseInt(userId) === parseInt(recipientId)) {
      await t.rollback();
      return res.status(400).json({ error: "Cannot chat with yourself" });
    }

    // Check existing conversation
    const existing = await Conversation.findOne({
      where: { type: "direct" },
      include: [
        {
          model: User,
          as: "participants",
          attributes: ["id"],
          through: { attributes: [] },
          where: { id: [userId, recipientId] },
        },
      ],
    });

    if (existing) {
      await t.commit();
      return res.json(existing);
    }

    // Create new conversation
    const conversation = await Conversation.create(
      { type: "direct", createdBy: userId },
      { transaction: t }
    );

    await Participant.bulkCreate(
      [
        { conversationId: conversation.id, userId },
        { conversationId: conversation.id, userId: recipientId },
      ],
      { transaction: t }
    );

    await t.commit();

    const fullConversation = await Conversation.findByPk(conversation.id, {
      include: [{ model: User, as: "participants", attributes: ["id", "fullName", "email"] }],
    });

    return res.status(201).json(fullConversation);
  } catch (err) {
    await t.rollback();
    console.error("startDirectChat error:", err);
    return res.status(500).json({ error: "Failed to start conversation" });
  }
};

// 🟠 Send message
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content, type } = req.body;
    const senderId = req.user.id;

    const participant = await Participant.findOne({
      where: { conversationId, userId: senderId },
    });

    if (!participant)
      return res.status(403).json({ error: "Not part of this conversation" });

    const message = await Message.create({
      conversationId,
      senderId,
      content,
      type: type || "text",
    });

    const populated = await Message.findByPk(message.id, {
      include: [
        { model: User, as: "sender", attributes: ["id", "fullName", "email"] },
      ],
    });

    return res.status(201).json(populated);
  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({ error: "Failed to send message" });
  }
};

// 🔵 Add participant to group
exports.addGroupMember = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId } = req.body;

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation || conversation.type !== "group")
      return res.status(400).json({ error: "Not a group conversation" });

    const exists = await Participant.findOne({ where: { conversationId, userId } });
    if (exists)
      return res.status(400).json({ error: "User already in group" });

    await Participant.create({ conversationId, userId });
    return res.status(200).json({ message: "User added to group" });
  } catch (err) {
    console.error("addGroupMember error:", err);
    return res.status(500).json({ error: "Failed to add member" });
  }
};

// 🔴 Leave conversation
exports.leaveConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const participant = await Participant.findOne({ where: { conversationId, userId } });
    if (!participant)
      return res.status(404).json({ error: "Not in conversation" });

    await participant.destroy();
    return res.status(200).json({ message: "Left conversation successfully" });
  } catch (err) {
    console.error("leaveConversation error:", err);
    return res.status(500).json({ error: "Failed to leave conversation" });
  }
};
