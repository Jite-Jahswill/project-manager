// socket/io.server.js
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { User, Role } = require("../models");

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
    },
  });

  // Auth middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("No token"));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.id, {
        include: [{ model: Role, as: "role" }],
      });
      if (!user) return next(new Error("User not found"));

      socket.user = {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`,
        role: user.role.name,
        permissions: user.role.permissions || [],
      };
      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`User ${socket.user.name} connected`);

    // Join personal room
    socket.join(`user:${socket.user.id}`);

    // Join conversation room
    socket.on("joinConversation", ({ conversationId }) => {
      socket.join(`conversation:${conversationId}`);
    });

    // Leave
    socket.on("leaveConversation", ({ conversationId }) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // Send message (real-time)
    socket.on("sendMessage", ({ conversationId, content, type = "text" }) => {
      if (!hasPermission(socket, "message:create")) return;

      // Save to DB (async, fire-and-forget)
      Message.create({
        content,
        type,
        conversationId,
        senderId: socket.user.id,
      }).catch(console.error);

      // Broadcast to room
      socket.to(`conversation:${conversationId}`).emit("newMessage", {
        id: Date.now(),
        content,
        type,
        sender: socket.user,
        timestamp: new Date(),
      });
    });

    // Typing indicator
    socket.on("typing", ({ conversationId, isTyping }) => {
      socket.to(`conversation:${conversationId}`).emit("userTyping", {
        userId: socket.user.id,
        isTyping,
      });
    });

    // Message updated
    socket.on("updateMessage", ({ conversationId, messageId, content }) => {
      socket.to(`conversation:${conversationId}`).emit("messageUpdated", {
        messageId,
        content,
      });
    });

    // Message deleted
    socket.on("deleteMessage", ({ conversationId, messageId }) => {
      socket.to(`conversation:${conversationId}`).emit("messageDeleted", {
        messageId,
      });
    });

    // Participant added
    socket.on("participantAdded", ({ conversationId, userId }) => {
      socket.to(`conversation:${conversationId}`).emit("participantAdded", {
        userId,
      });
    });

    socket.on("disconnect", () => {
      console.log(`User ${socket.user.name} disconnected`);
    });
  });
};

// Permission check for sockets
const hasPermission = (socket, perm) => {
  if (socket.user.role === "superadmin") return true;
  return socket.user.permissions.includes(perm);
};

module.exports = { initSocket };
