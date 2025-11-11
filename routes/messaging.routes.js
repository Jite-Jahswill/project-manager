const express = require("express");
const messagingController = require("../controllers/messaging.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Messaging
   *     description: Real-time chat with direct & group conversations, read receipts, and file support
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
   *         sender:
   *           $ref: '#/components/schemas/UserSummary'
   *         receiver:
   *           $ref: '#/components/schemas/UserSummary'
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   *
   *     Conversation:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 1 }
   *         type: { type: string, enum: [direct, group], example: "direct" }
   *         name: { type: string, nullable: true, example: "Chat with Oghomena" }
   *         createdBy: { type: integer, example: 1 }
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   *         participants:
   *           type: array
   *           items:
   *             $ref: '#/components/schemas/UserSummary'
   */

  /**
   * @swagger
   * /api/messaging/direct/{recipientId}:
   *   post:
   *     summary: Start or get a direct chat
   *     description: |
   *       Creates a new direct conversation or returns an existing one.
   *       - `receiverId` is used to determine the other participant.
   *       - Optional `name` for custom chat title.
   *     tags: [Messaging]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: recipientId
   *         required: true
   *         schema: { type: integer }
   *         example: 2
   *         description: ID of the user to chat with
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 example: "Support Chat"
   *     responses:
   *       201:
   *         description: Conversation created or fetched
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Conversation'
   *       400:
   *         description: Cannot chat with yourself
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post(
    "/direct/:recipientId",
    verifyToken,
    messagingController.startDirectChat
  );

  /**
   * @swagger
   * /api/messaging/{conversationId}/message:
   *   post:
   *     summary: Send a message
   *     description: |
   *       Sends a message in a conversation.
   *       - `receiverId` is auto-set for **direct chats**.
   *       - `isRead: false` by default.
   *       - Real-time via Socket.io (`newMessage`).
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
   *               content:
   *                 type: string
   *                 example: "Hey, how’s it going?"
   *               type:
   *                 type: string
   *                 enum: [text, image, file]
   *                 default: text
   *     responses:
   *       201:
   *         description: Message sent
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Message'
   *       403:
   *         description: Not part of conversation
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post(
    "/:conversationId/message",
    verifyToken,
    messagingController.sendMessage
  );

  /**
   * @swagger
   * /api/messaging/{conversationId}/messages:
   *   get:
   *     summary: Get all messages in a conversation
   *     description: |
   *       Fetches messages with sender/receiver.
   *       **Automatically marks unread messages as read** for the current user.
   *       Emits `messagesRead` via Socket.io.
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
   *         description: List of messages
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Message'
   *       403:
   *         description: Not part of conversation
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get(
    "/:conversationId/messages",
    verifyToken,
    messagingController.getAllMessages
  );

  /**
   * @swagger
   * /api/messaging/conversations:
   *   get:
   *     summary: Get all conversations for the user
   *     description: |
   *       Returns all direct & group chats the user is in.
   *       Includes `fullName` for participants.
   *       Sorted by `updatedAt` (latest first).
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
  router.get(
    "/conversations",
    verifyToken,
    messagingController.getAllConversations
  );

  /**
   * @swagger
   * /api/messaging/message/{messageId}:
   *   put:
   *     summary: Edit a message
   *     description: |
   *       Only the **sender** can edit.
   *       Sets `isEdited: true`.
   *       Emits `messageUpdated` via Socket.io.
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
   *               content:
   *                 type: string
   *                 example: "Actually, I meant tomorrow"
   *     responses:
   *       200:
   *         description: Message updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string, example: "Message updated successfully" }
   *                 data: { $ref: '#/components/schemas/Message' }
   *       403:
   *         description: Not the sender
   *       404:
   *         description: Message not found
   *       500:
   *         description: Server error
   */
  router.put(
    "/message/:messageId",
    verifyToken,
    messagingController.editMessage
  );

  /**
   * @swagger
   * /api/messaging/message/{messageId}:
   *   delete:
   *     summary: Delete a message (soft delete)
   *     description: |
   *       Only the **sender** can delete.
   *       Sets `isDeleted: true`, `content: null`.
   *       Emits `messageDeleted` via Socket.io.
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
   *         description: Message deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string, example: "Message deleted successfully" }
   *       403:
   *         description: Not the sender
   *       404:
   *         description: Message not found
   *       500:
   *         description: Server error
   */
  router.delete(
    "/message/:messageId",
    verifyToken,
    messagingController.deleteMessage
  );

  /**
   * @swagger
   * /api/messaging/group/{conversationId}/participant:
   *   post:
   *     summary: Add user to group
   *     description: |
   *       Requires `message:manage` permission.
   *       Emits `participantAdded` via Socket.io.
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
   *               userId:
   *                 type: integer
   *                 example: 7
   *     responses:
   *       200:
   *         description: User added
   *       400:
   *         description: Not a group or user already in group
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

  /**
   * @swagger
   * /api/messaging/conversation/{conversationId}:
   *   delete:
   *     summary: Leave a conversation
   *     description: |
   *       Removes the current user from direct or group chat.
   *       For direct chats: conversation remains (other user keeps it).
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
   *         description: Left conversation
   *       404:
   *         description: Not in conversation
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.delete(
    "/conversation/:conversationId",
    verifyToken,
    messagingController.leaveConversation
  );

  app.use("/api/messaging", router);
};
