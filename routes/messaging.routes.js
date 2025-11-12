// routes/messaging.routes.js
const express = require("express");
const messagingController = require("../controllers/messaging.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Messaging
   *     description: WhatsApp-style private & group chat with real-time updates
   *
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *
   *   schemas:
   *     UserSummary:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 2 }
   *         firstName: { type: string, example: "Oghomena" }
   *         lastName: { type: string, example: "Mena" }
   *         email: { type: string, example: "oghomenag@gmail.com" }
   *         fullName: { type: string, example: "Oghomena Mena" }
   *
   *     Message:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 34 }
   *         conversationId: { type: integer, example: 12 }
   *         senderId: { type: integer, example: 1 }
   *         receiverId: { type: integer, nullable: true, example: 2 }
   *         content: { type: string, example: "Hey, how’s it going?" }
   *         type: { type: string, enum: [text, image, file], example: "text" }
   *         isRead: { type: boolean, example: false }
   *         isEdited: { type: boolean, example: false }
   *         isDeleted: { type: boolean, example: false }
   *         sender: { $ref: '#/components/schemas/UserSummary' }
   *         receiver: { $ref: '#/components/schemas/UserSummary' }
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   *
   *     Conversation:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 1 }
   *         type: { type: string, enum: [direct, group], example: "direct" }
   *         name: { type: string, nullable: true, example: "Team Alpha" }
   *         createdBy: { type: integer, example: 1 }
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   *         participants:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/UserSummary'
   */

  // ─────────────────────────────────────
  // 1. PRIVATE CHAT (Click user → open chat)
  // ─────────────────────────────────────
  /**
   * @swagger
   * /api/messaging/direct/{recipientId}:
   *   post:
   *     summary: Open or create private chat
   *     description: |
   *       Gets existing 1-on-1 chat or creates a new one.
   *       - Auto-creates if not exists.
   *       - Returns full conversation with participants.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: recipientId
   *         required: true
   *         schema: { type: integer }
   *         example: 5
   *         description: ID of the other user
   *     responses:
   *       200:
   *         description: Existing chat
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Conversation' }
   *       201:
   *         description: New chat created
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Conversation' }
   *       400:
   *         description: Cannot chat with yourself
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post("/direct/:recipientId", verifyToken, messagingController.getPrivateChat);

  // ─────────────────────────────────────
  // 2. CREATE GROUP CHAT
  // ─────────────────────────────────────
  /**
   * @swagger
   * /api/messaging/group:
   *   post:
   *     summary: Create group chat
   *     description: |
   *       Creates a group with at least 3 members (including you).
   *       Emits `conversationCreated` via Socket.io.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, participantIds]
   *             properties:
   *               name: { type: string, example: "Project Team" }
   *               participantIds:
   *                 type: array
   *                 items: { type: integer }
   *                 example: [3, 4, 5]
   *                 description: Other users to add
   *     responses:
   *       201:
   *         description: Group created
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Conversation' }
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post("/group", verifyToken, messagingController.createGroupChat);

  // ─────────────────────────────────────
  // 3. ADD MEMBER TO GROUP
  // ─────────────────────────────────────
  /**
   * @swagger
   * /api/messaging/group/{conversationId}/participant:
   *   post:
   *     summary: Add user to group
   *     description: Requires `message:manage` permission.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *         example: 10
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [userId]
   *             properties:
   *               userId: { type: integer, example: 7 }
   *     responses:
   *       200:
   *         description: Member added
   *       400:
   *         description: Not a group or already in group
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post(
    "/group/:conversationId/participant",
    verifyToken,
    hasPermission("message:manage"),
    messagingController.addGroupMember
  );

  // ─────────────────────────────────────
  // 4. GET ALL CONVERSATIONS
  // ─────────────────────────────────────
  /**
   * @swagger
   * /api/messaging/conversations:
   *   get:
   *     summary: Get all chats (private + group)
   *     description: Sorted by latest message.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     responses:
   *       200:
   *         description: List of conversations
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Conversation'
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get("/conversations", verifyToken, messagingController.getAllConversations);

  // ─────────────────────────────────────
  // 5. SEND MESSAGE
  // ─────────────────────────────────────
  /**
   * @swagger
   * /api/messaging/{conversationId}/message:
   *   post:
   *     summary: Send message
   *     description: Real-time via Socket.io.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *         example: 12
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [content]
   *             properties:
   *               content: { type: string, example: "Hello!" }
   *               type: { type: string, enum: [text, image, file], default: text }
   *     responses:
   *       201:
   *         description: Message sent
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Message' }
   *       403:
   *         description: Not in conversation
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post("/:conversationId/message", verifyToken, messagingController.sendMessage);

  // ─────────────────────────────────────
  // 6. GET MESSAGES + MARK READ
  // ─────────────────────────────────────
  /**
   * @swagger
   * /api/messaging/{conversationId}/messages:
   *   get:
   *     summary: Get messages (auto-mark as read)
   *     description: Emits `messagesRead` via Socket.io.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *         example: 12
   *     responses:
   *       200:
   *         description: Messages
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Message'
   *       403:
   *         description: Not in conversation
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get("/:conversationId/messages", verifyToken, messagingController.getAllMessages);

  // ─────────────────────────────────────
  // 7. EDIT MESSAGE
  // ─────────────────────────────────────
  /**
   * @swagger
   * /api/messaging/message/{messageId}:
   *   put:
   *     summary: Edit message
   *     description: Only sender can edit.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema: { type: integer }
   *         example: 34
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               content: { type: string, example: "Fixed typo" }
   *     responses:
   *       200:
   *         description: Updated
   *       403:
   *         description: Not your message
   *       404:
   *         description: Not found
   *       500:
   *         description: Server error
   */
  router.put("/message/:messageId", verifyToken, messagingController.editMessage);

  // ─────────────────────────────────────
  // 8. DELETE MESSAGE
  // ─────────────────────────────────────
  /**
   * @swagger
   * /api/messaging/message/{messageId}:
   *   delete:
   *     summary: Delete message (soft)
   *     description: Only sender.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema: { type: integer }
   *         example: 34
   *     responses:
   *       200:
   *         description: Deleted
   *       403:
   *         description: Not your message
   *       404:
   *         description: Not found
   *       500:
   *         description: Server error
   */
  router.delete("/message/:messageId", verifyToken, messagingController.deleteMessage);

  // ─────────────────────────────────────
  // 9. LEAVE CONVERSATION
  // ─────────────────────────────────────
  /**
   * @swagger
   * /api/messaging/conversation/{conversationId}:
   *   delete:
   *     summary: Leave chat
   *     description: Works for private & group.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *         example: 10
   *     responses:
   *       200:
   *         description: Left
   *       404:
   *         description: Not in chat
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.delete("/conversation/:conversationId", verifyToken, messagingController.leaveConversation);

  // ─────────────────────────────────────
  // MOUNT ROUTER
  // ─────────────────────────────────────
  app.use("/api/messaging", router);
};
