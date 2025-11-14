// controllers/messaging.controller.js
const {
  Conversation,
  Participant,
  Message,
  MessageRecipient,
  User,
  sequelize,
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

const ensureConversationExists = async (conversationId) => {
  return await Conversation.findByPk(conversationId);
};

// -----------------------------
// 1. GET OR CREATE PRIVATE CHAT
// -----------------------------
exports.getOrCreatePrivateChat = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const recipientId = parseInt(req.params.recipientId);

    if (!recipientId) {
      return res.status(400).json({ message: "recipientId is required" });
    }
    if (recipientId === currentUserId) {
      return res.status(400).json({ message: "You cannot chat with yourself" });
    }

    // validate both users exist
    const usersExist = await User.findAll({
      where: { id: { [Op.in]: [currentUserId, recipientId] } }
    });
    if (usersExist.length !== 2) {
      return res.status(400).json({ message: "One or both users do not exist" });
    }

    // find conversation that has exactly these two participants
    const matchedConversations = await Participant.findAll({
      where: { userId: { [Op.in]: [currentUserId, recipientId] } },
      attributes: ["conversationId"],
      group: ["conversationId"],
      having: sequelize.literal("COUNT(DISTINCT userId) = 2")
    });

    if (matchedConversations.length > 0) {
      const convoId = matchedConversations[0].conversationId;

      const conversation = await Conversation.findByPk(convoId, {
        include: [
          {
            model: User,
            as: "participants",
            attributes: ["id", "firstName", "lastName", "email"],
            through: { attributes: [] }
          },
          {
            model: Message,
            as: "messages",
            include: [
              { model: User, as: "sender", attributes: ["id", "firstName", "lastName", "email"] },
              { model: User, as: "receiver", attributes: ["id", "firstName", "lastName", "email"] },
            ],
            order: [["createdAt", "ASC"]]
          }
        ]
      });

      return res.status(200).json({
        message: "Existing conversation found",
        conversation
      });
    }

    // create new direct conversation
    const newConversation = await Conversation.create({ type: "direct" });

    await Participant.bulkCreate([
      { userId: currentUserId, conversationId: newConversation.id },
      { userId: recipientId, conversationId: newConversation.id }
    ]);

    const createdConversation = await Conversation.findByPk(newConversation.id, {
      include: [
        {
          model: User,
          as: "participants",
          attributes: ["id", "firstName", "lastName", "email"],
          through: { attributes: [] }
        }
      ]
    });

    return res.status(201).json({
      message: "New conversation created",
      conversation: createdConversation
    });

  } catch (error) {
    console.error("getOrCreatePrivateChat error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message
    });
  }
};

// -----------------
// 2. CREATE GROUP
// -----------------
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
    console.error(err);
    res.status(500).json({ error: "Failed to create group" });
  }
};

// -----------------------------------------
// 3. GET ALL MY CHATS (private + groups)
// -----------------------------------------
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
    console.error(err);
    res.status(500).json({ error: "Failed to load chats" });
  }
};

// ------------------------------
// 4. SEND MESSAGE (text + files)
// ------------------------------
exports.sendMessage = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { conversationId } = req.params;
    const senderId = req.user.id;

    // Check conversation exists & sender is participant
    const convo = await Conversation.findByPk(conversationId, { transaction: t });
    if (!convo) {
      await t.rollback();
      return res.status(404).json({ error: "Conversation not found" });
    }

    const isParticipant = await Participant.findOne({
      where: { conversationId, userId: senderId },
      transaction: t,
    });
    if (!isParticipant) {
      await t.rollback();
      return res.status(403).json({ error: "Not in this chat" });
    }

    // Content & type
    let content = req.body.content;
    let type = "text";

    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      // support multiple files — but for now create one message per file OR one message with first file as content
      // We'll create one message per file for clarity
      const createdMessages = [];

      for (const file of req.uploadedFiles) {
        const fileContent = file.firebaseUrl;
        const fileType = file.mimetype.startsWith("image/") ? "image" : "file";

        const message = await Message.create({
          conversationId,
          senderId,
          receiverId: convo.type === "direct" ? (await Participant.findOne({
            where: { conversationId, userId: { [Op.ne]: senderId } },
            transaction: t,
          })).userId : null,
          content: fileContent,
          type: fileType,
        }, { transaction: t });

        // create recipients for group OR set message.isRead = false for direct (Message model has isRead)
        if (convo.type === "group") {
          // get participants except sender
          const participants = await Participant.findAll({ where: { conversationId, userId: { [Op.ne]: senderId } }, transaction: t });
          const recipientsPayload = participants.map(p => ({ messageId: message.id, userId: p.userId }));
          await MessageRecipient.bulkCreate(recipientsPayload, { transaction: t });
        } else {
          // direct message: create one recipient row for receiver to track read status
          await MessageRecipient.create({ messageId: message.id, userId: message.receiverId }, { transaction: t });
        }

        createdMessages.push(message);
      }

      await Conversation.update({ updatedAt: new Date() }, { where: { id: conversationId }, transaction: t });
      await t.commit();

      const lastId = createdMessages[createdMessages.length - 1].id;
      const fullMsg = await Message.findByPk(lastId, {
        include: [
          { model: User, as: "sender", attributes: ["id", "firstName", "lastName", "email"] },
          { model: User, as: "receiver", attributes: ["id", "firstName", "lastName", "email"] },
          { model: MessageRecipient, as: "recipients", include: [{ model: User, as: "user", attributes: ["id", "firstName", "lastName", "email"] }] },
        ],
      });

      return res.status(201).json(fullMsg);
    }

    // text message
    if (!content) {
      await t.rollback();
      return res.status(400).json({ error: "Message or file required" });
    }

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
      type: "text",
    }, { transaction: t });

    // recipients
    if (convo.type === "group") {
      const participants = await Participant.findAll({ where: { conversationId, userId: { [Op.ne]: senderId } }, transaction: t });
      const recipientsPayload = participants.map(p => ({ messageId: message.id, userId: p.userId }));
      await MessageRecipient.bulkCreate(recipientsPayload, { transaction: t });
    } else {
      if (receiverId) {
        await MessageRecipient.create({ messageId: message.id, userId: receiverId }, { transaction: t });
      }
    }

    await Conversation.update({ updatedAt: new Date() }, { where: { id: conversationId }, transaction: t });

    await t.commit();

    const fullMsg = await Message.findByPk(message.id, {
      include: [
        { model: User, as: "sender", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "receiver", attributes: ["id", "firstName", "lastName", "email"] },
        { model: MessageRecipient, as: "recipients", include: [{ model: User, as: "user", attributes: ["id", "firstName", "lastName", "email"] }] },
      ],
    });

    res.status(201).json(fullMsg);
  } catch (err) {
    await t.rollback();
    console.error("sendMessage error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
};

// -------------------------------------------------
// 5. GET MESSAGES → Auto mark as read (direct + group)
// -------------------------------------------------
exports.getMessages = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const convo = await Conversation.findByPk(conversationId, { transaction: t });
    if (!convo) {
      await t.rollback();
      return res.status(404).json({ error: "Conversation not found" });
    }

    const isParticipant = await Participant.findOne({ where: { conversationId, userId }, transaction: t });
    if (!isParticipant) {
      await t.rollback();
      return res.status(403).json({ error: "Not in chat" });
    }

    // Fetch all message IDs for this conversation
    const messageIds = await Message.findAll({
      where: { conversationId },
      attributes: ["id"],
      raw: true,
      transaction: t,
    });

    const ids = messageIds.map(m => m.id);

    if (ids.length > 0) {
      // mark as read for recipients
      await MessageRecipient.update(
        { isRead: true },
        { where: { userId, messageId: { [Op.in]: ids } }, transaction: t }
      );

      // legacy field for direct messages
      if (convo.type === "direct") {
        await Message.update(
          { isRead: true },
          { where: { conversationId, receiverId: userId, isRead: false }, transaction: t }
        );
      }
    }

    // fetch messages with sender + recipients info
    const messages = await Message.findAll({
      where: { conversationId },
      include: [
        { model: User, as: "sender", attributes: ["id", "firstName", "lastName", "email"] },
        { model: MessageRecipient, as: "recipients", include: [{ model: User, as: "user", attributes: ["id", "firstName", "lastName", "email"] }] },
      ],
      order: [["createdAt", "ASC"]],
      transaction: t,
    });

    await Conversation.update({ updatedAt: new Date() }, { where: { id: conversationId }, transaction: t });

    await t.commit();
    res.json(messages);
  } catch (err) {
    await t.rollback();
    console.error("getMessages error:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
};

// -----------------------------------------
// 6. ADD MEMBER TO GROUP (already present)
// -----------------------------------------
exports.addMember = async (req, res) => {
  const { conversationId } = req.params;
  const { userId } = req.body;
  const actorId = req.user.id;

  const convo = await Conversation.findByPk(conversationId);
  if (!convo || convo.type !== "group") return res.status(400).json({ error: "Not a group" });

  const alreadyIn = await Participant.findOne({ where: { conversationId, userId } });
  if (alreadyIn) return res.status(400).json({ error: "Already in group" });

  await Participant.create({ conversationId, userId });

  // For new member, optionally create MessageRecipient entries for existing group messages? usually not necessary.
  res.json({ message: "Member added" });
};

// -----------------------------------------
// 7. REMOVE MEMBER FROM GROUP
// -----------------------------------------
exports.removeMember = async (req, res) => {
  const { conversationId, memberId } = req.params;
  const actorId = req.user.id;

  const convo = await Conversation.findByPk(conversationId);
  if (!convo || convo.type !== "group") return res.status(400).json({ error: "Not a group" });

  if (parseInt(memberId) === parseInt(actorId)) {
    return res.status(400).json({ error: "Cannot remove yourself" });
  }

  await Participant.destroy({ where: { conversationId, userId: memberId } });

  // mark any MessageRecipient entries for that user in this conversation as isDeleted = true (optional)
  const messagesInConvo = await Message.findAll({ where: { conversationId }, attributes: ["id"] });
  const messageIds = messagesInConvo.map(m => m.id);
  if (messageIds.length > 0) {
    await MessageRecipient.update({ isDeleted: true }, { where: { messageId: { [Op.in]: messageIds }, userId: memberId } });
  }

  res.json({ message: "Member removed" });
};

// -----------------------------------------
// 8. DELETE GROUP (only creator) (already present)
// -----------------------------------------
exports.deleteGroup = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user.id;

  const convo = await Conversation.findByPk(conversationId);
  if (!convo || convo.type !== "group") return res.status(400).json({ error: "Not a group" });
  if (convo.createdBy !== userId) return res.status(403).json({ error: "Only creator can delete" });

  await convo.destroy();
  res.json({ message: "Group deleted" });
};

// -------------------------------------------------
// 9. DELETE CONVERSATION (direct or group)
//    -> soft delete messages? here we remove conversation and cascade
// -------------------------------------------------
exports.deleteConversation = async (req, res) => {
  const { conversationId } = req.params;
  const userId = req.user.id;

  const convo = await Conversation.findByPk(conversationId);
  if (!convo) return res.status(404).json({ error: "Conversation not found" });

  // only allow participants to delete the conversation locally? here we allow creator or participant to delete (global)
  const isParticipant = await Participant.findOne({ where: { conversationId, userId } });
  if (!isParticipant) return res.status(403).json({ error: "Not in this chat" });

  // full deletion (if you prefer soft-delete, add a flag instead)
  await convo.destroy();
  res.json({ message: "Conversation deleted" });
};

// -------------------------------------------------
// 10. EDIT MESSAGE (only sender) — soft edit
// -------------------------------------------------
exports.editMessage = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;
  const { content } = req.body;

  if (!content) return res.status(400).json({ error: "Content required" });

  const message = await Message.findByPk(messageId);
  if (!message) return res.status(404).json({ error: "Message not found" });
  if (message.senderId !== userId) return res.status(403).json({ error: "Not the sender" });
  if (message.isDeleted) return res.status(400).json({ error: "Message deleted" });

  message.content = content;
  message.isEdited = true;
  await message.save();

  const fullMsg = await Message.findByPk(message.id, {
    include: [
      { model: User, as: "sender", attributes: ["id", "firstName", "lastName", "email"] },
      { model: MessageRecipient, as: "recipients", include: [{ model: User, as: "user", attributes: ["id", "firstName", "lastName", "email"] }] },
    ],
  });

  res.json(fullMsg);
};

// -------------------------------------------------
// 11. DELETE MESSAGE (soft delete)
// -------------------------------------------------
exports.deleteMessage = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user.id;
  const { forEveryone } = req.body; // boolean: if true and sender, mark for everyone

  const message = await Message.findByPk(messageId);
  if (!message) return res.status(404).json({ error: "Message not found" });

  // if sender and forEveryone === true => mark message.isDeleted true (everyone)
  if (message.senderId === userId && forEveryone) {
    message.isDeleted = true;
    await message.save();

    // mark recipients isDeleted as true
    await MessageRecipient.update({ isDeleted: true }, { where: { messageId: message.id } });

    return res.json({ message: "Message deleted for everyone" });
  }

  // else: mark only this user's recipient row as deleted (for groups or direct)
  if (message.senderId === userId && message.receiverId === null) {
    // sender deleting their own message for self: you could soft flag but still let others see
    // we'll create a MessageRecipient row for sender and mark it deleted so they don't see it (optional)
    await MessageRecipient.upsert({ messageId: message.id, userId, isDeleted: true });
    return res.json({ message: "Message deleted for you" });
  }

  // if receiver deleting for self (direct message) or group member deleting for self:
  await MessageRecipient.update({ isDeleted: true }, { where: { messageId: message.id, userId } });

  res.json({ message: "Message deleted for you" });
};

// -------------------------------------------------
// 12. EDIT GROUP (e.g., update name)
// -------------------------------------------------
exports.editGroup = async (req, res) => {
  const { conversationId } = req.params;
  const { name } = req.body;
  const userId = req.user.id;

  const convo = await Conversation.findByPk(conversationId);
  if (!convo || convo.type !== "group") return res.status(400).json({ error: "Not a group" });

  // typical: allow creator or admin to rename — here we allow creator only
  if (convo.createdBy !== userId) return res.status(403).json({ error: "Only creator can edit group" });

  convo.name = name || convo.name;
  await convo.save();

  const full = await Conversation.findByPk(convo.id, {
    include: [{ model: User, as: "participants", attributes: ["id", "firstName", "lastName", "email"] }],
  });

  res.json({ ...full.toJSON(), participants: full.participants.map(formatUser) });
};
