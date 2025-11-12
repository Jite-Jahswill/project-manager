// socket/io.server.js
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { User, Role, Message, Participant, Conversation, sequelize, Op } = require("../models");

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // ──────────────────────────────────────────────────────────────
  // AUTH MIDDLEWARE
  // ──────────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication error: No token provided"));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.id, {
        include: [{ model: Role, as: "role", attributes: ["name", "permissions"] }],
        attributes: ["id", "firstName", "lastName", "email"],
      });

      if (!user) return next(new Error("User not found"));

      socket.user = {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim() || user.email,
        email: user.email,
        role: user.role.name,
        permissions: user.role.permissions || [],
      };

      next();
    } catch (err) {
      console.error("Socket auth error:", err.message);
      next(new Error("Invalid token"));
    }
  });

  // ──────────────────────────────────────────────────────────────
  // CONNECTION HANDLER
  // ──────────────────────────────────────────────────────────────
  io.on("connection", (socket) => {
    console.log(`User ${socket.user.name} connected (ID: ${socket.user.id})`);

    // Join personal room
    socket.join(`user:${socket.user.id}`);

    // ──────────────────────────────────
    // JOIN CONVERSATION
    // ──────────────────────────────────
    socket.on("joinConversation", async ({ conversationId }) => {
      try {
        const participant = await Participant.findOne({
          where: { conversationId, userId: socket.user.id },
        });
        if (!participant) {
          socket.emit("error", { message: "Not authorized to join this conversation" });
          return;
        }
        socket.join(`conversation:${conversationId}`);
        console.log(`${socket.user.name} joined conversation:${conversationId}`);

        const participants = await Participant.findAll({
          where: { conversationId },
          include: [{ model: User, attributes: ["id", "firstName", "lastName"] }],
        });
        socket.emit("participants", participants.map(p => ({
          id: p.User.id,
          name: `${p.User.firstName} ${p.User.lastName}`.trim(),
        })));
      } catch (err) {
        console.error("joinConversation error:", err);
      }
    });

    // ──────────────────────────────────
    // LEAVE CONVERSATION
    // ──────────────────────────────────
    socket.on("leaveConversation", ({ conversationId }) => {
      socket.leave(`conversation:${conversationId}`);
      console.log(`${socket.user.name} left conversation:${conversationId}`);
    });

    // ──────────────────────────────────
    // SEND MESSAGE
    // ──────────────────────────────────
    socket.on("sendMessage", async ({ conversationId, content, type = "text" }) => {
      if (!hasPermission(socket, "message:create")) {
        socket.emit("error", { message: "Permission denied" });
        return;
      }

      const t = await sequelize.transaction();
      try {
        const participant = await Participant.findOne({
          where: { conversationId, userId: socket.user.id },
          transaction: t,
        });
        if (!participant) {
          await t.rollback();
          socket.emit("error", { message: "Not in conversation" });
          return;
        }

        const conversation = await Conversation.findByPk(conversationId, { transaction: t });
        let receiverId = null;

        if (conversation.type === "direct") {
          const other = await Participant.findOne({
            where: { conversationId, userId: { [Op.ne]: socket.user.id } },
            transaction: t,
          });
          receiverId = other?.userId || null;
        }

        const message = await Message.create({
          conversationId,
          senderId: socket.user.id,
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

        const messageData = populated.toJSON();

        io.to(`conversation:${conversationId}`).emit("newMessage", messageData);

        if (receiverId) {
          io.to(`user:${receiverId}`).emit("newMessageNotification", {
            conversationId,
            message: messageData,
          });
        }
      } catch (err) {
        await t.rollback();
        console.error("sendMessage error:", err);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // ──────────────────────────────────
    // TYPING INDICATOR
    // ──────────────────────────────────
    socket.on("typing", ({ conversationId, isTyping }) => {
      socket.to(`conversation:${conversationId}`).emit("userTyping", {
        userId: socket.user.id,
        userName: socket.user.name,
        isTyping,
      });
    });

    // ──────────────────────────────────
    // MARK MESSAGES AS READ
    // ──────────────────────────────────
    socket.on("markMessagesRead", async ({ conversationId }) => {
      const t = await sequelize.transaction();
      try {
        await Message.update(
          { isRead: true },
          {
            where: {
              conversationId,
              receiverId: socket.user.id,
              senderId: { [Op.ne]: socket.user.id },
              isRead: false,
            },
            transaction: t,
          }
        );

        const updatedMessages = await Message.findAll({
          where: {
            conversationId,
            receiverId: socket.user.id,
            isRead: true,
          },
          attributes: ["id"],
          transaction: t,
        });

        await t.commit();

        const messageIds = updatedMessages.map(m => m.id);
        if (messageIds.length > 0) {
          io.to(`conversation:${conversationId}`).emit("messagesRead", {
            userId: socket.user.id,
            userName: socket.user.name,
            messageIds,
          });
        }
      } catch (err) {
        await t.rollback();
        console.error("markMessagesRead error:", err);
      }
    });

    // ──────────────────────────────────
    // MESSAGE UPDATED
    // ──────────────────────────────────
    socket.on("updateMessage", async ({ conversationId, messageId, content }) => {
      try {
        const message = await Message.findByPk(messageId);
        if (!message || message.senderId !== socket.user.id) return;

        await message.update({ content, isEdited: true });

        io.to(`conversation:${conversationId}`).emit("messageUpdated", {
          messageId,
          content,
          isEdited: true,
        });
      } catch (err) {
        console.error("updateMessage error:", err);
      }
    });

    // ──────────────────────────────────
    // MESSAGE DELETED
    // ──────────────────────────────────
    socket.on("deleteMessage", async ({ conversationId, messageId }) => {
      try {
        const message = await Message.findByPk(messageId);
        if (!message || message.senderId !== socket.user.id) return;

        await message.update({ isDeleted: true, content: null });

        io.to(`conversation:${conversationId}`).emit("messageDeleted", { messageId });
      } catch (err) {
        console.error("deleteMessage error:", err);
      }
    });

    // ──────────────────────────────────
    // PARTICIPANT ADDED
    // ──────────────────────────────────
    socket.on("participantAdded", ({ conversationId, userId }) => {
      io.to(`conversation:${conversationId}`).emit("participantAdded", { userId });
    });

    // ──────────────────────────────────
    // DISCONNECT
    // ──────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`User ${socket.user.name} disconnected`);
    });
  });
};

// ──────────────────────────────────────────────────────────────
// PERMISSION HELPER
// ──────────────────────────────────────────────────────────────
const hasPermission = (socket, perm) => {
  if (socket.user.role === "superadmin") return true;
  return Array.isArray(socket.user.permissions) && socket.user.permissions.includes(perm);
};

module.exports = { initSocket, io };
