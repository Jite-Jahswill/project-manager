const { sequelize, Document, Project, Client, Team, User, ClientProject, TeamProject } = require("../models");
const { Op } = require("sequelize");
const admin = require("firebase-admin");

module.exports = {
  // Create one or more documents for a project
  async createDocument(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { projectId } = req.params;
      const uploadedFiles = req.uploadedFiles || [];

      if (!projectId) {
        await transaction.rollback();
        return res.status(400).json({ message: "projectId is required" });
      }

      if (uploadedFiles.length === 0) {
        await transaction.rollback();
        return res.status(400).json({ message: "At least one file must be uploaded" });
      }

      // Verify project exists
      const [project] = await sequelize.query(
        `SELECT id FROM Projects WHERE id = :projectId`,
        {
          replacements: { projectId },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        }
      );
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ message: "Project not found" });
      }

      // Create documents using raw MySQL
      const documents = [];
      for (const file of uploadedFiles) {
        const [result] = await sequelize.query(
          `INSERT INTO Documents (name, firebaseUrl, projectId, type, size, uploadedBy, status, createdAt, updatedAt)
           VALUES (:name, :firebaseUrl, :projectId, :type, :size, :uploadedBy, :status, NOW(), NOW())`,
          {
            replacements: {
              name: file.originalname,
              firebaseUrl: file.firebaseUrl,
              projectId,
              type: file.mimetype.split("/")[1] || "unknown",
              size: file.size,
              uploadedBy: req.user.id,
              status: "pending",
            },
            type: sequelize.QueryTypes.INSERT,
            transaction,
          }
        );
        const [insertedDocument] = await sequelize.query(
          `SELECT * FROM Documents WHERE id = LAST_INSERT_ID()`,
          { type: sequelize.QueryTypes.SELECT, transaction }
        );
        documents.push(insertedDocument);
      }

      await transaction.commit();
      res.status(201).json({
        message: "Documents uploaded successfully",
        documents,
      });
    } catch (err) {
      await transaction.rollback();
      console.error("Create document error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        projectId: req.params.projectId,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to upload documents", details: err.message });
    }
  },

  // Get documents by projectId
  async getDocumentsByProject(req, res) {
    try {
      const { projectId } = req.params;
      const { page = 1, limit = 20, name } = req.query;

      if (!projectId) {
        return res.status(400).json({ message: "projectId is required" });
      }

      // Verify project exists
      const [project] = await sequelize.query(
        `SELECT id FROM Projects WHERE id = :projectId`,
        {
          replacements: { projectId },
          type: sequelize.QueryTypes.SELECT,
        }
      );
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      const searchCriteria = { projectId };
      if (name) {
        searchCriteria.name = { [Op.like]: `%${name}%` };
      }

      const { count, rows } = await Document.findAndCountAll({
        where: searchCriteria,
        include: [
          {
            model: User,
            as: "uploader",
            attributes: ["id", "firstName", "lastName", "email"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
      });

      const totalPages = Math.ceil(count / limit);

      res.status(200).json({
        documents: rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (err) {
      console.error("Get documents error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        projectId: req.params.projectId,
        query: req.query,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to fetch documents", details: err.message });
    }
  },

  // Update a document (name or file, not status)
  async updateDocument(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { documentId } = req.params;
      const { name } = req.body;
      const newFile = req.uploadedFiles && req.uploadedFiles[0];

      if (!documentId) {
        await transaction.rollback();
        return res.status(400).json({ message: "documentId is required" });
      }

      if (!name && !newFile) {
        await transaction.rollback();
        return res.status(400).json({ message: "At least one field (name or file) is required" });
      }

      // Verify document exists
      const [document] = await sequelize.query(
        `SELECT * FROM Documents WHERE id = :documentId`,
        {
          replacements: { documentId },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        }
      );
      if (!document) {
        await transaction.rollback();
        return res.status(404).json({ message: "Document not found" });
      }

      // Prepare updates
      const updates = {};
      if (name) updates.name = name;
      if (newFile) {
        updates.firebaseUrl = newFile.firebaseUrl;
        updates.type = newFile.mimetype.split("/")[1] || "unknown";
        updates.size = newFile.size;

        // Delete old file from Firebase
        const oldFileName = document.firebaseUrl.split("/").pop();
        await admin.storage().bucket().file(`Uploads/${oldFileName}`).delete().catch((err) => {
          console.error(`Failed to delete old file: ${err.message}`);
        });
      }

      // Update document using raw MySQL
      await sequelize.query(
        `UPDATE Documents
         SET name = :name, firebaseUrl = :firebaseUrl, type = :type, size = :size, updatedAt = NOW()
         WHERE id = :documentId`,
        {
          replacements: {
            name: updates.name || document.name,
            firebaseUrl: updates.firebaseUrl || document.firebaseUrl,
            type: updates.type || document.type,
            size: updates.size || document.size,
            documentId,
          },
          type: sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      // Fetch updated document
      const [updatedDocument] = await sequelize.query(
        `SELECT * FROM Documents WHERE id = :documentId`,
        {
          replacements: { documentId },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        }
      );

      await transaction.commit();
      res.status(200).json({ message: "Document updated successfully", document: updatedDocument });
    } catch (err) {
      await transaction.rollback();
      console.error("Update document error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        documentId: req.params.documentId,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to update document", details: err.message });
    }
  },

  // Update document status only
  async updateDocumentStatus(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { documentId } = req.params;
      const { status } = req.body;

      if (!documentId) {
        await transaction.rollback();
        return res.status(400).json({ message: "documentId is required" });
      }

      if (!status) {
        await transaction.rollback();
        return res.status(400).json({ message: "status is required" });
      }

      if (!["pending", "approved", "rejected", "completed", "not complete"].includes(status)) {
        await transaction.rollback();
        return res.status(400).json({ message: "Invalid status. Must be pending, approved, rejected, completed, or not complete" });
      }

      // Verify document exists
      const [document] = await sequelize.query(
        `SELECT * FROM Documents WHERE id = :documentId`,
        {
          replacements: { documentId },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        }
      );
      if (!document) {
        await transaction.rollback();
        return res.status(404).json({ message: "Document not found" });
      }

      // Update document status using raw MySQL
      await sequelize.query(
        `UPDATE Documents
         SET status = :status, updatedAt = NOW()
         WHERE id = :documentId`,
        {
          replacements: { status, documentId },
          type: sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      // Fetch updated document
      const [updatedDocument] = await sequelize.query(
        `SELECT * FROM Documents WHERE id = :documentId`,
        {
          replacements: { documentId },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        }
      );

      await transaction.commit();
      res.status(200).json({ message: "Document status updated successfully", document: updatedDocument });
    } catch (err) {
      await transaction.rollback();
      console.error("Update document status error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        documentId: req.params.documentId,
        body: req.body,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to update document status", details: err.message });
    }
  },

  // Delete a document
  async deleteDocument(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { documentId } = req.params;

      if (!documentId) {
        await transaction.rollback();
        return res.status(400).json({ message: "documentId is required" });
      }

      // Verify document exists
      const [document] = await sequelize.query(
        `SELECT * FROM Documents WHERE id = :documentId`,
        {
          replacements: { documentId },
          type: sequelize.QueryTypes.SELECT,
          transaction,
        }
      );
      if (!document) {
        await transaction.rollback();
        return res.status(404).json({ message: "Document not found" });
      }

      // Delete file from Firebase
      const fileName = document.firebaseUrl.split("/").pop();
      await admin.storage().bucket().file(`Uploads/${fileName}`).delete().catch((err) => {
        console.error(`Failed to delete file: ${err.message}`);
      });

      // Delete document using raw MySQL
      await sequelize.query(
        `DELETE FROM Documents WHERE id = :documentId`,
        {
          replacements: { documentId },
          type: sequelize.QueryTypes.DELETE,
          transaction,
        }
      );

      await transaction.commit();
      res.status(200).json({ message: "Document deleted successfully" });
    } catch (err) {
      await transaction.rollback();
      console.error("Delete document error:", {
        message: err.message,
        stack: err.stack,
        userId: req.user?.id,
        documentId: req.params.documentId,
        timestamp: new Date().toISOString(),
      });
      res.status(500).json({ message: "Failed to delete document", details: err.message });
    }
  },
};
