const express = require("express");
const messagingController = require("../controllers/messaging.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * /api/messaging/direct/{recipientId}:
   *   post:
   *     summary: Start or get a direct chat
   *     description: Creates a new direct conversation between two users or returns an existing one.
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: recipientId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 5
   *         description: ID of the recipient user
   *     responses:
   *       201:
   *         description: Conversation created or fetched
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
   *     description: Sends a message in a conversation.
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 12
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - content
   *             properties:
   *               content:
   *                 type: string
   *                 example: "Hey, how’s it going?"
   *               type:
   *                 type: string
   *                 example: "text"
   *     responses:
   *       201:
   *         description: Message sent successfully
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
   *     description: Fetch all messages in a specific conversation with sender details.
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 12
   *     responses:
   *       200:
   *         description: List of messages
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Not part of conversation
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
   * /api/messaging/message/{messageId}:
   *   put:
   *     summary: Edit a message
   *     description: Allows the sender to edit a previously sent message.
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema:
   *           type: integer
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
   *                 example: "Updated message content"
   *     responses:
   *       200:
   *         description: Message edited successfully
   *       403:
   *         description: Unauthorized to edit
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
   *     summary: Delete a message
   *     description: Allows the sender or admin to delete a message.
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 34
   *     responses:
   *       200:
   *         description: Message deleted successfully
   *       404:
   *         description: Message not found
   *       401:
   *         description: Unauthorized
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
   *     description: Adds a new participant to a group conversation.
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 10
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - userId
   *             properties:
   *               userId:
   *                 type: integer
   *                 example: 7
   *     responses:
   *       200:
   *         description: User added successfully
   *       400:
   *         description: Not a group conversation
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
   *     description: Removes the authenticated user from a conversation (direct or group).
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 10
   *     responses:
   *       200:
   *         description: Left conversation successfully
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
