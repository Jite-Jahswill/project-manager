// routes/directChat.routes.js
const express = require("express");
const { verifyToken } = require("../middlewares/auth.middleware");
const { upload, uploadToFirebase } = require("../middlewares/upload.middleware");
const directChatController = require("../controllers/directChat.controller");

module.exports = (app) => {
  const router = express.Router();

  /**
   * @swagger
   * tags:
   *   - name: Direct Chat
   *     description: Private 1-on-1 messaging (text, image, file) with read receipts & edit/delete
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
   *         firstName: { type: string, example: "Alex" }
   *         lastName: { type: string, example: "Morgan" }
   *         email: { type: string, example: "alex@company.com" }
   *         fullName: { type: string, example: "Alex Morgan" }
   *
   *     DirectMessage:
   *       type: object
   *       properties:
   *         id: { type: integer, example: 101 }
   *         senderId: { type: integer }
   *         receiverId: { type: integer }
   *         content:
   *           type: string
   *           nullable: true
   *           example: "https://firebasestorage.googleapis.com/v0/b/app/o/chat%2Fimg-123.jpg"
   *         type:
   *           type: string
   *           enum: [text, image, file]
   *           example: "image"
   *         isRead: { type: boolean, default: false }
   *         isEdited: { type: boolean, default: false }
   *         isDeleted: { type: boolean, default: false }
   *         sender: { $ref: '#/components/schemas/UserSummary' }
   *         receiver: { $ref: '#/components/schemas/UserSummary' }
   *         createdAt: { type: string, format: date-time }
   *         updatedAt: { type: string, format: date-time }
   */

  // ===================================================================
  // 1. GET CHAT HISTORY (between two users) + MARK AS READ
  // ===================================================================
  /**
   * @swagger
   * /api/direct-chat/{user1}/{user2}:
   *   get:
   *     summary: Get chat history between two users + auto mark as read
   *     description: |
   *       Fetches **all messages** exchanged between `user1` and `user2` (in any direction).
   *       
   *       **Security**: Only allowed if the **logged-in user** is **one of the two participants**.
   *       - If not → returns `403 Forbidden`.
   *       
   *       **Read Receipts**: Automatically marks **unread messages sent to the logged-in user** as `isRead: true`.
   *       
   *       **Response**: Clean, formatted message list with full sender/receiver info.
   *     tags: [Direct Chat]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: user1
   *         required: true
   *         schema: { type: integer }
   *         example: 1
   *         description: User ID of first participant
   *       - in: path
   *         name: user2
   *         required: true
   *         schema: { type: integer }
   *         example: 5
   *         description: User ID of second participant
   *     responses:
   *       200:
   *         description: Chat history retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id: { type: integer, example: 101 }
   *                   content: { type: string, nullable: true, example: "Hey! How's it going?" }
   *                   type: { type: string, enum: [text, image, file], example: "text" }
   *                   isRead: { type: boolean, example: true }
   *                   isEdited: { type: boolean, example: false }
   *                   isDeleted: { type: boolean, example: false }
   *                   createdAt: { type: string, format: date-time }
   *                   updatedAt: { type: string, format: date-time }
   *                   sender: { $ref: '#/components/schemas/UserSummary' }
   *                   receiver: { $ref: '#/components/schemas/UserSummary' }
   *             example:
   *               - id: 101
   *                 content: "Hello!"
   *                 type: "text"
   *                 isRead: true
   *                 isEdited: false
   *                 isDeleted: false
   *                 createdAt: "2025-04-05T10:00:00Z"
   *                 updatedAt: "2025-04-05T10:00:00Z"
   *                 sender:
   *                   id: 1
   *                   firstName: "John"
   *                   lastName: "Doe"
   *                   email: "john@company.com"
   *                   fullName: "John Doe"
   *                 receiver:
   *                   id: 5
   *                   firstName: "Jane"
   *                   lastName: "Smith"
   *                   email: "jane@company.com"
   *                   fullName: "Jane Smith"
   *       403:
   *         description: Forbidden — you are not part of this conversation
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error: { type: string, example: "You are not part of this conversation" }
   *       401:
   *         description: Unauthorized — invalid or missing token
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 error: { type: string }
   *                 details: { type: string }
   */
  router.get(
    "/:user1/:user2",
    verifyToken,
    directChatController.getChatHistory
  );

  // ===================================================================
  // 2. SEND MESSAGE (text or file/image)
  // ===================================================================
  /**
   * @swagger
   * /api/direct-chat/send:
   *   post:
   *     summary: Send a direct message
   *     description: |
   *       Send text or upload file/image.
   *       - Text → `content` field
   *       - File → `files` (uploaded to Firebase → URL in `content`)
   *     tags: [Direct Chat]
   *     security: [bearerAuth: []]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               receiverId:
   *                 type: integer
   *                 example: 5
   *                 description: ID of the recipient
   *               content:
   *                 type: string
   *                 description: Text message (required if no file)
   *               files:
   *                 type: array
   *                 items:
   *                   type: string
   *                   format: binary
   *                 description: Optional — image or file
   *     responses:
   *       201:
   *         description: Message sent
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DirectMessage' }
   *       400:
   *         description: Missing content/file or receiver
   */
  router.post(
    "/send",
    verifyToken,
    upload,
    uploadToFirebase,
    directChatController.sendMessage
  );

  // ===================================================================
  // 3. EDIT MESSAGE
  // ===================================================================
  /**
   * @swagger
   * /api/direct-chat/message/{messageId}:
   *   put:
   *     summary: Edit a message (sender only)
   *     tags: [Direct Chat]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema: { type: integer }
   *         example: 101
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
   *                 example: "Actually, let's meet at 3 PM"
   *     responses:
   *       200:
   *         description: Message updated
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DirectMessage' }
   *       403:
   *         description: Not the sender
   *       404:
   *         description: Message not found
   */
  router.put(
    "/message/:messageId",
    verifyToken,
    directChatController.editMessage
  );

  // ===================================================================
  // 4. DELETE MESSAGE (soft delete)
  // ===================================================================
  /**
   * @swagger
   * /api/direct-chat/message/{messageId}:
   *   delete:
   *     summary: Soft delete a message
   *     description: |
   *       Any participant can delete (marks `isDeleted: true`).
   *       Message still exists in DB but is hidden.
   *     tags: [Direct Chat]
   *     security: [bearerAuth: []]
   *     parameters:
   *       - in: path
   *         name: messageId
   *         required: true
   *         schema: { type: integer }
   *         example: 101
   *     responses:
   *       200:
   *         description: Message deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message: { type: string, example: "Message deleted" }
   *       403:
   *         description: Not sender or receiver
   *       404:
   *         description: Message not found
   */
  router.delete(
    "/message/:messageId",
    verifyToken,
    directChatController.deleteMessage
  );

  // ===================================================================
  // MOUNT ROUTER
  // ===================================================================
  app.use("/api/direct-chat", router);
};
