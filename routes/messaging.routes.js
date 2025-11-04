const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middlewares/auth.middleware");
const messaging = require("../controllers/messaging.controller");

// Direct chat
router.post("/direct/:recipientId", verifyToken, messaging.startDirectChat);

// Messages CRUD
router.post("/:conversationId/message", verifyToken, messaging.sendMessage);
router.get("/:conversationId/messages", verifyToken, messaging.getAllMessages);
router.put("/message/:messageId", verifyToken, messaging.editMessage);
router.delete("/message/:messageId", verifyToken, messaging.deleteMessage);

// Group
router.post("/group/:conversationId/participant", verifyToken, messaging.addGroupMember);
router.delete("/conversation/:conversationId", verifyToken, messaging.leaveConversation);

module.exports = router;
