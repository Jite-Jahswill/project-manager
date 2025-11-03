// routes/messaging.routes.js
const express = require("express");
const messagingController = require("../controllers/messaging.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  // Create/get 1:1 conversation
  router.post(
    "/conversation/:userId",
    verifyToken,
    hasPermission("message:read"),
    messagingController.createOrGetConversation
  );

  // Create group
  router.post(
    "/group",
    verifyToken,
    hasPermission("message:create"),
    messagingController.createGroupConversation
  );

  // Send message
  router.post(
    "/send",
    verifyToken,
    hasPermission("message:create"),
    messagingController.sendMessage
  );

  // Get messages
  router.get(
    "/conversation/:conversationId/messages",
    verifyToken,
    hasPermission("message:read"),
    messagingController.getMessages
  );

  // Update message
  router.put(
    "/message/:messageId",
    verifyToken,
    hasPermission("message:update"),
    messagingController.updateMessage
  );

  // Delete message
  router.delete(
    "/message/:messageId",
    verifyToken,
    hasPermission("message:delete"),
    messagingController.deleteMessage
  );

  // Add to group
  router.post(
    "/group/:conversationId/participant",
    verifyToken,
    hasPermission("message:manage"),
    messagingController.addParticipant
  );

  // Leave group
  router.delete(
    "/conversation/:conversationId",
    verifyToken,
    messagingController.leaveConversation
  );

  app.use("/api/messages", router);
};
