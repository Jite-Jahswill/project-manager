// controllers/messaging.controller.js
const {
  Conversation,
  Participant,
  Message,
  User,
  sequelize,
  Op,
} = require("../models");
const { Op } = require("sequelize");

// Helper
const formatUser = (u) => ({
  id: u.id,
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  fullName: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email,
});

// 1. GET OR CREATE PRIVATE CHAT (Click user → open chat)
exports.getOrCreatePrivateChat = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const currentUserId = req.user.id;
    const { recipientId } = req.params;

    if (parseInt(currentUserId) === parseInt(recipientId)) {
      return res.status(400).json({ error: "Cannot chat with yourself" });
    }

    // Find existing direct chat
    const existing = await Conversation.findOne({
      where: { type: "direct" },
      include: [{
        model: User,
        as: "participants",
        where: { id: { [Op.in]: [currentUserId, recipientId] } },
        through: { attributes: [] },
      }],
      group: ["Conversation.id"],
      having: sequelize.literal(`COUNT(DISTINCT "participants"."id") = 2`),
      transaction: t,
    });

    if (existing) {
      const convo = await Conversation.findByPk(existing.id, {
        include: [{ model: User, as: "participants", attributes: ["id", "firstName", "lastName", "email"] }],
        transaction: t,
      });
      await t.commit();
      return res.json({
        ...convo.toJSON(),
        participants: convo.participants.map(formatUser),
      });
    }

    // Create new private chat
    const convo = await Conversation.create({ type: "direct", createdBy: currentUserId }, { transaction: t });
    await Participant.bulkCreate([
      { conversationId: convo.id, userId: currentUserId },
      { conversationId: convo.id, userId: recipientId },
    ], { transaction: t });

    await t.commit();

    const full = await Conversation.findByPk(convo.id, {
      include: [{ model: User, as: "participants", attributes: ["id", "firstName", "lastName", "email"] }],
    });

    return res.status(201).json({
      ...full.toJSON(),
      participants: full.participants.map(formatUser),
    });
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ error: "Failed to open chat" });
  }
};

// 2. CREATE GROUP
exports.createGroup = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { name, participantIds } = req.body;
    const creatorId = req.user.id;

    if (!name || !Array.isArray(participantIds) || participantIds.length < 2) {
      return res.status(400).json({ error: "Name + at least 2 others required" });
    }

    const allIds = [...new Set([creatorId, ...participantIds])];
    if (allIds.length < 3) return res.status(400).json({ error: "Group needs 3+ members" });

    const group = await Conversation.create({
      type: "group",
      name,
      createdBy: creatorId,
    }, { transaction: t });

    await Participant.bulkCreate(
      allIds.map(id => ({ conversationId: group.id, userId: id })),
      { transaction: t }
    );

    await t.commit();

    const full = await Conversation.findByPk(group.id, {
      include: [{ model: User, as: "participants", attributes: ["id", "firstName", "lastName", "email"] }],
    });

    res.status(201).json({
      ...full.toJSON(),
      participants: full.participants.map(formatUser),
    });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: "Failed to create group" });
  }
};

// 3. GET ALL MY CHATS (Private + Groups)
exports.getMyConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const convos = await Conversation.findAll({
      include: [{
        model: User,
        as: "participants",
        where: { id: userId },
        through: { attributes: [] },
        attributes: ["id", "firstName", "lastName", "email"],
      }],
      order: [["updatedAt", "DESC"]],
    });

    res.json(convos.map(c => ({
      ...c.toJSON(),
      participants: c.participants.map(formatUser),
    })));
  } catch (err) {
    res.status(500).json({ error: "Failed to load chats" });
  }
};

// 4. SEND MESSAGE (Text + Files via upload middleware)
exports.sendMessage = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { conversationId } = req.params;
    const senderId = req.user.id;

    // Check if user is in conversation
    const isParticipant = await Participant.findOne({
      where: { conversationId, userId: senderId },
      transaction: t,
    });
    if (!isParticipant) return res.status(403).json({ error: "Not in this chat" });

    let content = req.body.content;
    let type = "text";

    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const file = req.uploadedFiles[0];
      content = file.firebaseUrl;
      type = file.mimetype.startsWith("image/") ? "image" : "file";
    }

    if (!content) return res.status(400).json({ error: "Message or file required" });

    const convo = await Conversation.findByPk(conversationId, { transaction: t });
    let receiverId = null;
    if (convo.type === "direct") {
      const other = await Participant.findOne({
        where: { conversationId, userId: { [Op.ne]: senderId } },
        transaction: t,
      });
      receiverId = other?.userId;
    }

    const message = await Message.create({
      conversationId,
      senderId,
      receiverId,
      content,
      type,
    }, { transaction: t });

    await Conversation.update(
      { updatedAt: new Date() },
      { where: { id: conversationId }, transaction: t }
    );

    await t.commit();

    const fullMsg = await Message.findByPk(message.id, {
      include: [
        { model: User, as: "sender", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "receiver", attributes: ["id", "firstName", "lastName", "email"] },
      ],
    });

    res.status(201).json(fullMsg);
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ error: "Failed to send message" });
  }
};

// 5. GET MESSAGES → Auto mark as read
exports.getMessages = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const isParticipant = await Participant.findOne({
      where: { conversationId, userId },
      transaction: t,
    });
    if (!isParticipant) return res.status(403).json({ error: "Not in chat" });

    // Mark unread messages from others as read
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
      ],
      order: [["createdAt", "ASC"]],
      transaction: t,
    });

    await t.commit();
    res.json(messages);
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: "Failed to load messages" });
  }
};

// 6. ADD MEMBER TO GROUP
exports.addMember = async (req, res) => {
  const { conversationId } = req.params;
  const { userId } = req.body;
  const actorId = req.user.id;

  const convo = await Conversation.findByPk(conversationId);
  if (!convo || convo.type !== "group") return res.status(400).json({ error: "Not a group" });

  const alreadyIn = await Participant.findOne({ where: { conversationId, userId } });
  if (alreadyIn) return res.status(400).json({ error: "Already in group" });

  await Participant.create({ conversationId, userId });
  res.json({ message: "Member added" });
};

// 7. REMOVE MEMBER FROM GROUP
exports.removeMember = async (req, res) => {
  const { conversationId, memberId } = req.params;
  const actorId = req.user.id;

  const convo = await Conversation.findByPk(conversationId);
  if (!convo || convo.type !== "group") return res.status(400).json({ error: "Not a group" });

  if (parseInt(memberId) === parseInt(actorId)) {
    return res.status(400).json({ error: "Cannot remove yourself" });
  }

  await Participant.destroy({ where: { conversationId, userId: memberId } });
  res.json({ message: "Member removed" });
};

// 8. DELETE GROUP (Only creator)
exports.deleteGroup = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user.id;

  const convo = await Conversation.findByPk(conversationId);
  if (!convo || convo.type !== "group") return res.status(400).json({ error: "Not a group" });
  if (convo.createdBy !== userId) return res.status(403).json({ error: "Only creator can delete" });

  await convo.destroy();
  res.json({ message: "Group deleted" });
};
