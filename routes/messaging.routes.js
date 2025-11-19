// routes/messaging.routes.js
const express = require("express");
const { verifyToken,hasPermission } = require("../middlewares/auth.middleware");
const { upload, uploadToFirebase } = require("../middlewares/upload.middleware");
const messagingController = require("../controllers/messaging.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Messaging
   *     description: Full WhatsApp-style messaging – DMs, groups, files, polls, reactions, read receipts, typing
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
   *         id: { type: integer, example: 1 }
   *         firstName: { type: string, example: "John" }
   *         lastName: { type: string, example: "Doe" }
   *         email: { type: string, example: "john@company.com" }
   *         fullName: { type: string, example: "John Doe" }
   *
   *     MessageRecipient:
   *       type: object
   *       properties:
   *         userId: { type: integer }
   *         isRead: { type: boolean, default: false }
   *         isDeleted: { type: boolean, default: false }
   *         user: { $ref: '#/components/schemas/UserSummary' }
   *
   *     Message:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 42 }
   *         conversationId: { type: integer }
   *         senderId: { type: integer }
   *         receiverId: { type: integer, nullable: true }
   *         content: { type: string, nullable: true, example: "https://firebasestorage.googleapis.com/..." }
   *         type:
   *           type: string
   *           enum: [text, image, file, poll]
   *           example: "text"
   *         replyTo: { type: integer, nullable: true, example: 38 }
   *         reaction: { type: string, nullable: true, example: "Like" }
   *         pollOptions:
   *           type: array
   *           items: { type: string }
   *           nullable: true
   *           example: ["Yes", "No", "Maybe"]
   *         pollVotes:
   *           type: object
   *           additionalProperties: { type: integer }
   *           nullable: true
   *           example: { "Yes": 3, "No": 1 }
   *         fileUrls:
   *           type: array
   *           items: { type: string }
   *           example: ["https://storage.../img1.jpg"]
   *         isRead: { type: boolean, default: false }
   *         isEdited: { type: boolean, default: false }
   *         isDeleted: { type: boolean, default: false }
   *         sender: { $ref: '#/components/schemas/UserSummary' }
   *         recipients:
   *           type: array
   *           items: { $ref: '#/components/schemas/MessageRecipient' }
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   *
   *     Conversation:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 12 }
   *         type: { type: string, enum: [direct, group], example: "group" }
   *         name: { type: string, nullable: true, example: "Dev Team" }
   *         createdBy: { type: integer, example: 1 }
   *         participants:
   *           type: array
   *           items: { $ref: '#/components/schemas/UserSummary' }
   *         lastMessage:
   *           type: object
   *           nullable: true
   *           $ref: '#/components/schemas/Message'
   *         unreadCount: { type: integer, example: 5 }
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   */

  // ===================================================================
  // 1. OPEN OR CREATE PRIVATE CHAT
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/direct/{recipientId}:
   *   post:
   *     summary: Open or create 1-on-1 chat
   *     description: |
   *       Finds existing direct chat or creates a new one.
   *       Returns full conversation with participants.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: recipientId
   *         required: true
   *         schema: { type: integer }
   *         example: 7
   *         description: ID of the other user
   *     responses:
   *       200:
   *         description: Existing chat
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string, example: "Existing conversation found" }
   *                 conversation: { $ref: '#/components/schemas/Conversation' }
   *       201:
   *         description: New chat created
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string, example: "New conversation created" }
   *                 conversation: { $ref: '#/components/schemas/Conversation' }
   *       400:
   *         description: Invalid recipient or self-chat
   */
  router.post("/direct/:recipientId", verifyToken, messagingController.getOrCreatePrivateChat);

  // ===================================================================
  // 2. CREATE GROUP
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/group:
   *   post:
   *     summary: Create group chat
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
   *               name:
   *                 type: string
   *                 example: "Project Alpha"
   *               participantIds:
   *                 type: array
   *                 items: { type: integer }
   *                 minItems: 2
   *                 example: [3, 5, 8]
   *                 description: Other users (you are added automatically)
   *     responses:
   *       201:
   *         description: Group created
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Conversation' }
   *       400:
   *         description: Need name + 2+ others
   */
  router.post("/group", verifyToken, messagingController.createGroup);

  // ===================================================================
  // 3. GET ALL MY CONVERSATIONS
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/conversations:
   *   get:
   *     summary: Get all my chats
   *     description: Private + group, sorted by latest activity
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     responses:
   *       200:
   *         description: List of conversations
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items: { $ref: '#/components/schemas/Conversation' }
   */
  router.get("/conversations", verifyToken, messagingController.getMyConversations);

  // ===================================================================
  // 4. SEND MESSAGE (text, file, poll, reply)
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/{conversationId}/message:
   *   post:
   *     summary: Send message
   *     description: |
   *       Supports:
   *       - Text
   *       - File/image upload (via `files`)
   *       - Poll (`pollOptions`)
   *       - Reply (`replyTo`)
   *       - Multiple files → multiple messages
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               content:
   *                 type: string
   *                 description: Text content (required if no file/poll)
   *               replyTo:
   *                 type: integer
   *                 description: Message ID to reply to
   *               pollOptions:
   *                 type: array
   *                 items: { type: string }
   *                 description: For poll messages
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Upload images/files
   *     responses:
   *       201:
   *         description: Last message sent
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Message' }
   *       403:
   *         description: Not in conversation
   */
  router.post(
    "/:conversationId/message",
    verifyToken,
    upload,
    uploadToFirebase,
    messagingController.sendMessage
  );

  // ===================================================================
  // 5. GET MESSAGES (auto mark as read)
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/{conversationId}/messages:
   *   get:
   *     summary: Get messages + mark as read
   *     description: |
   *       - Marks **your** unread messages as read
   *       - Returns full message list with `recipients` (for group read status)
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200:
   *         description: Messages
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items: { $ref: '#/components/schemas/Message' }
   */
  router.get("/:conversationId/messages", verifyToken, messagingController.getMessages);

  // ===================================================================
  // 6. EDIT MESSAGE
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/message/{messageId}:
   *   put:
   *     summary: Edit message (sender only)
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [content]
   *             properties:
   *               content: { type: string, example: "Fixed typo" }
   *     responses:
   *       200:
   *         description: Updated message
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Message' }
   */
  router.put("/message/:messageId", verifyToken, messagingController.editMessage);

  // ===================================================================
  // 7. DELETE MESSAGE (soft)
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/message/{messageId}:
   *   delete:
   *     summary: Delete message (soft)
   *     description: |
   *       - `forEveryone: true` → delete for all (sender only)
   *       - Otherwise → delete for self
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               forEveryone:
   *                 type: boolean
   *                 default: false
   *                 description: Only sender can set to true
   *     responses:
   *       200:
   *         description: Deleted
   */
  router.delete("/message/:messageId", verifyToken, messagingController.deleteMessage);

  // ===================================================================
  // 8. ADD MEMBER TO GROUP
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/group/{conversationId}/member:
   *   post:
   *     summary: Add user to group
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [userId]
   *             properties:
   *               userId: { type: integer, example: 9 }
   *     responses:
   *       200: { description: Member added }
   */
  router.post("/group/:conversationId/member", verifyToken, messagingController.addMember);

  // ===================================================================
  // 9. REMOVE MEMBER FROM GROUP
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/group/{conversationId}/member/{memberId}:
   *   delete:
   *     summary: Remove member from group
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *       - in: path
   *         name: memberId
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Member removed }
   */
  router.delete("/group/:conversationId/member/:memberId", verifyToken, messagingController.removeMember);

  // ===================================================================
  // 10. DELETE GROUP (creator only)
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/group/{conversationId}:
   *   delete:
   *     summary: Delete group (creator only)
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Group deleted }
   */
  router.delete("/group/:conversationId", verifyToken, messagingController.deleteGroup);

  // ===================================================================
  // 11. EDIT GROUP NAME (creator only)
  // ===================================================================
  /**
   * @swagger
   * /api/messaging/group/{conversationId}:
   *   put:
   *     summary: Edit group name
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name]
   *             properties:
   *               name: { type: string, example: "Updated Team Name" }
   *     responses:
   *       200:
   *         description: Group updated
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Conversation' }
   */
  router.put("/group/:conversationId", verifyToken, messagingController.editGroup);

  // ===================================================================
  // MOUNT
  // ===================================================================
  app.use("/api/messaging", router);
};
