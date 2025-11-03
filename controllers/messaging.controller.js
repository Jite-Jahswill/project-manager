const { Op } = require("sequelize");
const { sequelize, Conversation, Message, ConversationParticipant, Participant, User } = require("../models");

// ---------------------------------------------------------------------
// CREATE or GET DIRECT CONVERSATION (1:1 CHAT)
// ---------------------------------------------------------------------
exports.createOrGetConversation = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;
    const otherUserId = Number(userId);

    // ✅ Validation
    if (!otherUserId || isNaN(otherUserId)) {
      await t.rollback();
      return res.status(400).json({ error: "Invalid userId parameter" });
    }

    if (otherUserId === currentUserId) {
      await t.rollback();
      return res.status(400).json({ error: "Cannot chat with yourself" });
    }

    // Step 1: Try to find an existing direct conversation
     const conversation = await Conversation.findOne({
      where: { id: conversationId },
      include: [
        {
          model: Message,
          as: "messages", // ✅ Must match the alias
          include: [
            {
              model: User,
              as: "sender", // ✅ Because you aliased it in db.Message.belongsTo(db.User, { as: 'sender' })
              attributes: ["id", "fullName", "email"],
            },
          ],
        },
        {
          model: User,
          as: "participants", // ✅ Must match Conversation.belongsToMany(User, { as: 'participants' })
          attributes: ["id", "fullName", "email"],
        },
      ],
    });


    let finalConversation;

    if (conversation) {
      finalConversation = conversation;
    } else {
      // Step 2: Create a new conversation
      finalConversation = await Conversation.create(
        { isGroup: false, type: "direct" },
        { transaction: t }
      );

      await Participant.bulkCreate(
        [
          { conversationId: finalConversation.id, userId: currentUserId },
          { conversationId: finalConversation.id, userId: otherUserId },
        ],
        { transaction: t }
      );
    }

    // ✅ Commit once all DB operations succeed
    await t.commit();

    // Step 3: Load full conversation outside transaction
    const fullConv = await Conversation.findByPk(finalConversation.id, {
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
          include: [
            { model: User, as: "sender", attributes: ["id", "firstName", "lastName"] },
          ],
        },
      ],
    });

    return res.status(200).json({ conversation: fullConv });
  } catch (err) {
    // ✅ Only rollback if not already committed/rolled back
    if (t && !t.finished) await t.rollback();
    console.error("createOrGetConversation error:", err);
    return res.status(500).json({ error: "Failed to create/get conversation" });
  }
};

exports.addParticipant = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId } = req.body;

    if (!userId)
      return res.status(400).json({ message: "userId is required" });

    // Fetch conversation
    const conversation = await Conversation.findByPk(conversationId);

    if (!conversation)
      return res.status(404).json({ message: "Conversation not found" });

    // Ensure it's a group
    if (!conversation.isGroup)
      return res.status(400).json({ message: "Not a group conversation" });

    // Ensure user exists
    const user = await User.findByPk(userId);
    if (!user)
      return res.status(404).json({ message: "User not found" });

    // Check if already participant
    const existing = await ConversationParticipant.findOne({
      where: { conversationId, userId },
    });
    if (existing)
      return res.status(400).json({ message: "User already in group" });

    // Add participant
    await ConversationParticipant.create({
      conversationId,
      userId,
      joinedAt: new Date(),
    });

    return res.status(200).json({
      message: "User added to group successfully",
      data: {
        conversationId,
        userId,
      },
    });
  } catch (error) {
    console.error("❌ Error adding participant:", error);
    return res.status(500).json({
      message: "Server error adding participant",
      error: error.message,
    });
  }
};

exports.getAllMessages = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search ? req.query.search.trim() : "";

    // Build search filter
    const where = {};
    if (search) {
      where[Op.or] = [
        { content: { [Op.like]: `%${search}%` } },
        { "$sender.firstName$": { [Op.like]: `%${search}%` } },
        { "$sender.lastName$": { [Op.like]: `%${search}%` } },
        { "$conversation.name$": { [Op.like]: `%${search}%` } },
      ];
    }

    const { rows: messages, count } = await Message.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: "sender",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        {
          model: Conversation,
          as: "conversation",
          attributes: ["id", "name", "isGroup", "type"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    const totalPages = Math.ceil(count / limit);

    return res.status(200).json({
      messages,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: count,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching all messages:", error);
    return res.status(500).json({
      message: "Server error fetching messages",
      error: error.message,
    });
  }
};


// ---------------------------------------------------------------------
// CREATE GROUP CONVERSATION
// ---------------------------------------------------------------------
exports.createGroupConversation = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { name, userIds = [] } = req.body;
    const currentUserId = req.user.id;

    if (!name?.trim()) {
      await t.rollback();
      return res.status(400).json({ error: "Group name is required" });
    }

    // Ensure current user is also in participants
    if (!userIds.includes(currentUserId)) userIds.push(currentUserId);

    const conversation = await Conversation.create(
      { name: name.trim(), isGroup: true, type: "group" },
      { transaction: t }
    );

    const participantsData = userIds.map((uid) => ({
      conversationId: conversation.id,
      userId: uid,
    }));

    await Participant.bulkCreate(participantsData, { transaction: t });

    await t.commit();

    const fullGroup = await Conversation.findByPk(conversation.id, {
      include: [
        {
          model: User,
          as: "participants",
          attributes: ["id", "firstName", "lastName", "email"],
          through: { attributes: [] },
        },
      ],
    });

    return res.status(201).json({ group: fullGroup });
  } catch (err) {
    await t.rollback();
    console.error("createGroupConversation error:", err);
    return res.status(500).json({ error: "Failed to create group conversation" });
  }
};

// ---------------------------------------------------------------------
// GET USER'S CONVERSATIONS
// ---------------------------------------------------------------------
exports.getUserConversations = async (req, res) => {
  try {
    const currentUserId = req.user.id;

    const conversations = await Conversation.findAll({
      include: [
        {
          model: User,
          as: "participants",
          attributes: ["id", "firstName", "lastName", "email"],
          through: { attributes: [] },
          where: { id: currentUserId },
        },
        {
          model: Message,
          as: "messages",
          limit: 1,
          order: [["createdAt", "DESC"]],
          include: [{ model: User, as: "sender", attributes: ["id", "firstName", "lastName"] }],
        },
      ],
      order: [["updatedAt", "DESC"]],
    });

    return res.status(200).json({ conversations });
  } catch (err) {
    console.error("getUserConversations error:", err);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
};

// ---------------------------------------------------------------------
// GET MESSAGES IN A CONVERSATION
// ---------------------------------------------------------------------
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;

    const messages = await Message.findAll({
      where: { conversationId },
      include: [
        {
          model: User,
          as: "sender",
          attributes: ["id", "firstName", "lastName", "email"],
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    return res.status(200).json({ messages });
  } catch (err) {
    console.error("getMessages error:", err);
    return res.status(500).json({ error: "Failed to fetch messages" });
  }
};

// ---------------------------------------------------------------------
// SEND MESSAGE
// ---------------------------------------------------------------------
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content, type = "text" } = req.body;
    const senderId = req.user.id;

    if (!content?.trim()) {
      return res.status(400).json({ error: "Message content is required" });
    }

    const message = await Message.create({
      conversationId,
      senderId,
      content: content.trim(),
      type,
    });

    const fullMessage = await Message.findByPk(message.id, {
      include: [
        {
          model: User,
          as: "sender",
          attributes: ["id", "firstName", "lastName", "email"],
        },
      ],
    });

    return res.status(201).json({ message: fullMessage });
  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({ error: "Failed to send message" });
  }
};

// ---------------------------------------------------------------------
// UPDATE MESSAGE
// ---------------------------------------------------------------------
exports.updateMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    const message = await Message.findByPk(messageId);

    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.senderId !== userId)
      return res.status(403).json({ error: "Cannot edit another user's message" });

    message.content = content;
    message.isEdited = true;
    await message.save();

    return res.status(200).json({ message });
  } catch (err) {
    console.error("updateMessage error:", err);
    return res.status(500).json({ error: "Failed to update message" });
  }
};

// ---------------------------------------------------------------------
// DELETE MESSAGE
// ---------------------------------------------------------------------
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    const message = await Message.findByPk(messageId);

    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.senderId !== userId)
      return res.status(403).json({ error: "Cannot delete another user's message" });

    message.isDeleted = true;
    await message.save();

    return res.status(200).json({ message });
  } catch (err) {
    console.error("deleteMessage error:", err);
    return res.status(500).json({ error: "Failed to delete message" });
  }
};

exports.leaveConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id; // comes from verifyToken middleware

    // Check conversation
    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation)
      return res.status(404).json({ message: "Conversation not found" });

    // Check if user is a participant
    const participant = await ConversationParticipant.findOne({
      where: { conversationId, userId },
    });

    if (!participant)
      return res.status(404).json({ message: "You are not part of this conversation" });

    // Remove participant
    await participant.destroy();

    return res.status(200).json({
      message: "You have left the conversation successfully",
      data: { conversationId },
    });
  } catch (error) {
    console.error("❌ Error leaving conversation:", error);
    return res.status(500).json({
      message: "Server error while leaving conversation",
      error: error.message,
    });
  }
};
