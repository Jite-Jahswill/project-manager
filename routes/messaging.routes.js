const express = require("express");
const messagingController = require("../controllers/messaging.controller");
const { verifyToken, hasPermission } = require("../middlewares/auth.middleware");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   name: Messaging
   *   description: Messaging and conversations API
   */

  /**
   * @swagger
   * /api/messaging/direct/{userId}:
   *   post:
   *     summary: Create or get direct (1:1) conversation
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: integer
   *         description: ID of the other user to start chat with
   *     responses:
   *       200:
   *         description: Conversation retrieved or created successfully
   *       400:
   *         description: Cannot chat with yourself
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post(
    "/direct/:userId",
    verifyToken,
    hasPermission("message:create"),
    messagingController.createOrGetConversation
  );

  /**
   * @swagger
   * /api/messaging/group:
   *   post:
   *     summary: Create a group conversation
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 example: Project Alpha Discussion
   *               userIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 example: [2, 3, 4]
   *     responses:
   *       201:
   *         description: Group created successfully
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.post(
    "/group",
    verifyToken,
    hasPermission("message:create"),
    messagingController.createGroupConversation
  );

  /**
   * @swagger
   * /api/messaging/conversations:
   *   get:
   *     summary: Get all conversations of the authenticated user
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of user conversations
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Server error
   */
  router.get(
    "/conversations",
    verifyToken,
    hasPermission("message:read"),
    messagingController.getUserConversations
  );

  /**
   * @swagger
   * /api/messaging/{conversationId}/messages:
   *   get:
   *     summary: Get all messages in a conversation
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema:
   *           type: integer
   *         description: ID of the conversation
   *     responses:
   *       200:
   *         description: Messages retrieved successfully
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Conversation not found
   *       500:
   *         description: Server error
   */
  router.get(
    "/:conversationId/messages",
    verifyToken,
    hasPermission("message:read"),
    messagingController.getMessages
  );

  /**
   * @swagger
   * /api/messaging/{conversationId}/messages:
   *   post:
   *     summary: Send a new message in a conversation
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: conversationId
   *         required: true
   *         schema:
   *           type: integer
   *         description: ID of the conversation
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               content:
   *                 type: string
   *                 example: "Hey team, let's meet at 2 PM"
   *               type:
   *                 type: string
   *                 enum: [text, image, file, system]
   *                 example: text
   *     responses:
   *       201:
   *         description: Message sent successfully
   *       400:
   *         description: Invalid message data
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Conversation not found
   *       500:
   *         description: Server error
   */
  router.post(
    "/:conversationId/messages",
    verifyToken,
    hasPermission("message:create"),
    messagingController.sendMessage
  );

  /**
   * @swagger
   * /api/messaging/messages/{messageId}:
   *   put:
   *     summary: Update a message
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema:
   *           type: integer
   *         description: ID of the message to update
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
   *         description: Message updated successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden
   *       404:
   *         description: Message not found
   *       500:
   *         description: Server error
   */
  router.put(
    "/messages/:messageId",
    verifyToken,
    hasPermission("message:update"),
    messagingController.updateMessage
  );

  /**
   * @swagger
   * /api/messaging/messages/{messageId}:
   *   delete:
   *     summary: Delete a message
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema:
   *           type: integer
   *         description: ID of the message to delete
   *     responses:
   *       200:
   *         description: Message deleted successfully
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden
   *       404:
   *         description: Message not found
   *       500:
   *         description: Server error
   */
  router.delete(
    "/messages/:messageId",
    verifyToken,
    hasPermission("message:delete"),
    messagingController.deleteMessage
  );

  /**
   * @swagger
   * /api/messages/all:
   *   get:
   *     summary: Get all messages (admin only)
   *     description: Returns a paginated list of every message in the system with sender and conversation details.
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *         description: Page number
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *         description: Messages per page
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *         description: Search in message content, sender name, or group name
   *     responses:
   *       200:
   *         description: All messages retrieved
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 messages:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Message'
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     currentPage:
   *                       type: integer
   *                     totalPages:
   *                       type: integer
   *                     totalItems:
   *                       type: integer
   *                     itemsPerPage:
   *                       type: integer
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Admin access required
   *       500:
   *         description: Server error
   */
  router.get(
    "/",
    verifyToken,
    hasPermission("message:admin"), // or role check: (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json(...)
    messagingController.getAllMessages
  );

  /**
   * @swagger
   * /api/messages/group:
   *   post:
   *     summary: Create group conversation
   *     description: Creates a new group chat with multiple users.
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - userIds
   *             properties:
   *               name:
   *                 type: string
   *                 example: "Dev Team Alpha"
   *               userIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 minItems: 2
   *                 description: At least 2 user IDs (excluding current user)
   *                 example: [3, 4]
   *     responses:
   *       201:
   *         description: Group created
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 conversation:
   *                   $ref: '#/components/schemas/Conversation'
   *       400:
   *         description: Invalid input
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Missing permission
   *       500:
   *         description: Server error
   */
  router.post(
    "/group",
    verifyToken,
    hasPermission("message:create"),
    messagingController.createGroupConversation
  );

  /**
   * @swagger
   * /api/messages/send:
   *   post:
   *     summary: Send a message
   *     description: Sends a text, image, or file message to a conversation.
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - conversationId
   *               - content
   *             properties:
   *               conversationId:
   *                 type: integer
   *                 example: 10
   *               content:
   *                 type: string
   *                 example: "Hello team!"
   *               type:
   *                 type: string
   *                 enum: [text, image, file]
   *                 default: text
   *                 example: text
   *     responses:
   *       200:
   *         description: Message sent
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Message'
   *       400:
   *         description: Missing fields
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Not in conversation
   *       500:
   *         description: Server error
   */
  router.post(
    "/send",
    verifyToken,
    hasPermission("message:create"),
    messagingController.sendMessage
  );

  /**
   * @swagger
   * /api/messages/conversation/{conversationId}/messages:
   *   get:
   *     summary: Get conversation messages
   *     description: Fetches paginated messages from a conversation.
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
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *         description: Page number
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *         description: Messages per page
   *     responses:
   *       200:
   *         description: Messages retrieved
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 messages:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Message'
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Not in conversation
   *       404:
   *         description: Conversation not found
   *       500:
   *         description: Server error
   */
  router.get(
    "/conversation/:conversationId/messages",
    verifyToken,
    hasPermission("message:read"),
    messagingController.getMessages
  );

  /**
   * @swagger
   * /api/messages/message/{messageId}:
   *   put:
   *     summary: Edit a message
   *     description: Updates the content of a message sent by the user.
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 25
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
   *                 example: "Updated message"
   *     responses:
   *       200:
   *         description: Message updated
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Not message owner
   *       404:
   *         description: Message not found
   *       500:
   *         description: Server error
   */
  router.put(
    "/message/:messageId",
    verifyToken,
    hasPermission("message:update"),
    messagingController.updateMessage
  );

  /**
   * @swagger
   * /api/messages/message/{messageId}:
   *   delete:
   *     summary: Delete a message
   *     description: Soft deletes a message (marks as deleted).
   *     tags: [Messaging]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema:
   *           type: integer
   *         example: 25
   *     responses:
   *       200:
   *         description: Message deleted
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Not message owner
   *       404:
   *         description: Message not found
   *       500:
   *         description: Server error
   */
  router.delete(
    "/message/:messageId",
    verifyToken,
    hasPermission("message:delete"),
    messagingController.deleteMessage
  );

  /**
   * @swagger
   * /api/messages/group/{conversationId}/participant:
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
   *         example: 12
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
   *         description: User added
   *       400:
   *         description: Not a group
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Insufficient permission
   *       500:
   *         description: Server error
   */
  router.post(
    "/group/:conversationId/participant",
    verifyToken,
    hasPermission("message:manage"),
    messagingController.addParticipant
  );

  /**
   * @swagger
   * /api/messages/conversation/{conversationId}:
   *   delete:
   *     summary: Leave conversation
   *     description: Removes the authenticated user from a conversation (group or 1:1).
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
   *         description: Left conversation
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Not in conversation
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
