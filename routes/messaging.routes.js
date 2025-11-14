// routes/messaging.routes.js
const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const { upload, uploadToFirebase } = require("../middlewares/upload.middleware");
const messagingController = require("../controllers/messaging.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Messaging
   *     description: WhatsApp-style private & group chat (file upload, read receipts, full control)
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
   *         id: { type: integer }
   *         firstName: { type: string }
   *         lastName: { type: string }
   *         email: { type: string }
   *         fullName: { type: string }
   *
   *     Message:
   *       type: object
   *       properties:
   *         id: { type: integer }
   *         conversationId: { type: integer }
   *         senderId: { type: integer }
   *         receiverId: { type: integer, nullable: true }
   *         content: { type: string }
   *         type: { type: string, enum: [text, image, file] }
   *         isRead: { type: boolean }
   *         isEdited: { type: boolean }
   *         isDeleted: { type: boolean }
   *         sender: { $ref: '#/components/schemas/UserSummary' }
   *         receiver: { $ref: '#/components/schemas/UserSummary', nullable: true }
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   *
   *     Conversation:
   *       type: object
   *       properties:
   *         id: { type: integer }
   *         type: { type: string, enum: [direct, group] }
   *         name: { type: string, nullable: true }
   *         createdBy: { type: integer }
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   *         participants:
   *           type: array
   *           items: { $ref: '#/components/schemas/UserSummary' }
   */

  // 1. OPEN PRIVATE CHAT (Click any user → chat opens)
  /**
   * @swagger
   * /api/messaging/direct/{recipientId}:
   *   post:
   *     summary: Open or create private chat
   *     description: Gets existing 1-on-1 or creates new one automatically.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: recipientId
   *         required: true
   *         schema: { type: integer }
   *         example: 7
   *     responses:
   *       200: { description: Existing chat }
   *       201: { description: New chat created }
   *       400: { description: Cannot chat with yourself }
   */
  router.post("/direct/:recipientId", verifyToken, messagingController.getOrCreatePrivateChat);

  // 2. CREATE GROUP
  /**
   * @swagger
   * /api/messaging/group:
   *   post:
   *     summary: Create new group
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
   *               name: { type: string, example: "Dev Team 2025" }
   *               participantIds:
   *                 type: array
   *                 items: { type: integer }
   *                 minItems: 2
   *                 example: [3, 5, 8]
   *     responses:
   *       201: { description: Group created, $ref: '#/components/schemas/Conversation' }
   *       400: { description: Invalid data }
   */
  router.post("/group", verifyToken, messagingController.createGroup);

  // 3. GET ALL MY CHATS
  /**
   * @swagger
   * /api/messaging/conversations:
   *   get:
   *     summary: Get all my conversations
   *     description: Private + group chats, sorted by latest activity
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

  // 4. SEND MESSAGE (Text + Image + File)
  /**
   * @swagger
   * /api/messaging/{conversationId}/message:
   *   post:
   *     summary: Send message (text or file)
   *     description: Supports text and file upload (image/file). File → Firebase → URL stored.
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
   *                 description: Text message (required if no file)
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Optional file/image
   *     responses:
   *       201: { description: Message sent, $ref: '#/components/schemas/Message' }
   *       403: { description: Not in conversation }
   */
  router.post(
    "/:conversationId/message",
    verifyToken,
    upload,
    uploadToFirebase,
    messagingController.sendMessage
  );

  // 5. GET MESSAGES → Auto mark as read
  /**
   * @swagger
   * /api/messaging/{conversationId}/messages:
   *   get:
   *     summary: Get messages (auto mark as read)
   *     description: All unread messages from others are marked as read when fetched.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200:
   *         description: Messages list
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items: { $ref: '#/components/schemas/Message' }
   */
  router.get("/:conversationId/messages", verifyToken, messagingController.getMessages);

  // 6. ADD MEMBER TO GROUP
  /**
   * @swagger
   * /api/messaging/group/{conversationId}/member:
   *   post:
   *     summary: Add member to group
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
   *               userId: { type: integer }
   *     responses:
   *       200: { description: Member added }
   *       400: { description: Already in group or not a group }
   */
  router.post("/group/:conversationId/member", verifyToken, messagingController.addMember);

  // 7. REMOVE MEMBER FROM GROUP
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

  // 8. DELETE GROUP (Creator only)
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
   *       403: { description: Only creator can delete }
   */
  router.delete("/group/:conversationId", verifyToken, messagingController.deleteGroup);

  // Mount
  app.use("/api/messaging", router);
};
