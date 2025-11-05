const { sequelize, Document, Project, Client, Team, User, ClientProject, TeamProject } = require("../models");
const { Op } = require("sequelize");
const admin = require("firebase-admin");
console.log("Firebase Key starts with:", process.env.FIREBASE_PRIVATE_KEY?.slice(0, 20));


module.exports = {
  // Create one or more documents for a project
  async createDocument(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { projectId } = req.params;
      const { reportId } = req.body; // Optional
      const uploadedFiles = req.uploadedFiles || [];

      if (!projectId) {
        await transaction.rollback();
        return res.status(400).json({ message: "projectId is required" });
      }
      if (uploadedFiles.length === 0) {
        await transaction.rollback();
        return res.status(400).json({ message: "At least one file must be uploaded" });
      }

      // Validate project
      const project = await Project.findByPk(projectId, { transaction });
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ message: "Project not found" });
      }

      // Validate reportId if provided
      if (reportId) {
        const report = await sequelize.models.Report.findByPk(reportId, { transaction });
        if (!report) {
          await transaction.rollback();
          return res.status(404).json({ message: "Report not found" });
        }
        if (report.projectId !== parseInt(projectId)) {
          await transaction.rollback();
          return res.status(400).json({ message: "Report does not belong to this project" });
        }
      }

      const documents = [];
      for (const file of uploadedFiles) {
        const [result] = await sequelize.query(
          `INSERT INTO Documents 
           (name, firebaseUrl, projectId, reportId, type, size, uploadedBy, status, createdAt, updatedAt)
           VALUES (:name, :firebaseUrl, :projectId, :reportId, :type, :size, :uploadedBy, :status, NOW(), NOW())`,
          {
            replacements: {
              name: file.originalname,
              firebaseUrl: file.firebaseUrl,
              projectId,
              reportId: reportId || null,
              type: file.mimetype.split("/")[1] || "unknown",
              size: file.size,
              uploadedBy: req.user.id,
              status: "pending",
            },
            type: sequelize.QueryTypes.INSERT,
            transaction,
          }
        );

        const [doc] = await sequelize.query(
          `SELECT * FROM Documents WHERE id = LAST_INSERT_ID()`,
          { type: sequelize.QueryTypes.SELECT, transaction }
        );
        documents.push(doc);
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
          reportId: req.body?.reportId,
          timestamp: new Date().toISOString(),
        });
        res.status(500).json({ message: "Failed to upload documents", details: err.message });
      }
    },
  
  async getAllDocuments(req, res) {
    try {
      const { page = 1, limit = 20, search, status, projectId, reportId } = req.query;
      const where = {};

      if (status) where.status = status;
      if (projectId) where.projectId = projectId;
      if (reportId) where.reportId = reportId === "null" ? null : reportId;

      const searchConditions = [];
      if (search) {
        const like = `%${search}%`;
        searchConditions.push({ name: { [Op.like]: like } });
      }

      const { count, rows } = await Document.findAndCountAll({
        where: {
          ...where,
          ...(searchConditions.length > 0 ? { [Op.or]: searchConditions } : {}),
        },
        include: [
          { model: Project, as: "Project", attributes: ["id", "name"] },
          { model: User, as: "uploader", attributes: ["id", "firstName", "lastName", "email"] },
          { model: sequelize.models.Report, as: "report", attributes: ["id", "title"], required: false },
        ],
        order: [["createdAt", "DESC"]],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
      });

      res.status(200).json({
        documents: rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / limit),
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (err) {
      console.error("Get all documents error:", err);
      res.status(500).json({ message: "Failed to fetch documents", details: err.message });
    }
  },

async getDocumentsByProject(req, res) {
    try {
      const { projectId } = req.params;
      const { page = 1, limit = 20, name, reportId } = req.query;

      if (!projectId) return res.status(400).json({ message: "projectId is required" });

      const project = await Project.findByPk(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const where = { projectId };
      if (name) where.name = { [Op.like]: `%${name}%` };
      if (reportId) where.reportId = reportId === "null" ? null : reportId;

      const { count, rows } = await Document.findAndCountAll({
        where,
        include: [
          { model: User, as: "uploader", attributes: ["id", "firstName", "lastName"] },
          { model: sequelize.models.Report, as: "report", attributes: ["id", "title"], required: false },
        ],
        order: [["createdAt", "DESC"]],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
      });

      res.status(200).json({
        documents: rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / limit),
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
      });
    } catch (err) {
      console.error("Get documents by project error:", err);
      res.status(500).json({ message: "Failed to fetch documents", details: err.message });
    }
  },

  // UPDATE: Change name, file, or reportId
  async updateDocument(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { documentId } = req.params;
      const { name, reportId } = req.body;
      const newFile = req.uploadedFiles?.[0];

      if (!documentId) {
        await transaction.rollback();
        return res.status(400).json({ message: "documentId is required" });
      }
      if (!name && !newFile && reportId === undefined) {
        await transaction.rollback();
        return res.status(400).json({ message: "At least one field (name, file, reportId) is required" });
      }

      const document = await Document.findByPk(documentId, { transaction });
      if (!document) {
        await transaction.rollback();
        return res.status(404).json({ message: "Document not found" });
      }

      // Validate reportId if changing
      if (reportId !== undefined) {
        if (reportId === null) {
          // Allow detach
        } else {
          const report = await sequelize.models.Report.findByPk(reportId, { transaction });
          if (!report) {
            await transaction.rollback();
            return res.status(404).json({ message: "Report not found" });
          }
          if (report.projectId !== document.projectId) {
            await transaction.rollback();
            return res.status(400).json({ message: "Report must belong to the same project" });
          }
        }
      }

      const updates = {};
      if (name) updates.name = name;
      if (newFile) {
        updates.firebaseUrl = newFile.firebaseUrl;
        updates.type = newFile.mimetype.split("/")[1] || "unknown";
        updates.size = newFile.size;

        // Delete old file
        const oldFileName = document.firebaseUrl.split("/").pop();
        await admin.storage().bucket().file(`Uploads/${oldFileName}`).delete().catch(() => {});
      }
      if (reportId !== undefined) updates.reportId = reportId;

      await sequelize.query(
        `UPDATE Documents SET 
         name = :name, firebaseUrl = :firebaseUrl, type = :type, size = :size, 
         reportId = :reportId, updatedAt = NOW()
         WHERE id = :documentId`,
        {
          replacements: {
            name: updates.name ?? document.name,
            firebaseUrl: updates.firebaseUrl ?? document.firebaseUrl,
            type: updates.type ?? document.type,
            size: updates.size ?? document.size,
            reportId: updates.reportId ?? document.reportId,
            documentId,
          },
          type: sequelize.QueryTypes.UPDATE,
          transaction,
        }
      );

      const [updated] = await sequelize.query(
        `SELECT * FROM Documents WHERE id = :documentId`,
        { replacements: { documentId }, type: sequelize.QueryTypes.SELECT, transaction }
      );

      const previous = await Model.findByPk(id);
      req.body._previousData = previous.toJSON();

      await transaction.commit();
      res.status(200).json({ message: "Document updated", document: updated });
    } catch (err) {
      await transaction.rollback();
      console.error("Update document error:", err);
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

      const previous = await Model.findByPk(id);
      req.body._previousData = previous.toJSON();

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

// DELETE: Safe (unlinks from report)
  async deleteDocument(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { documentId } = req.params;
      if (!documentId) {
        await transaction.rollback();
        return res.status(400).json({ message: "documentId is required" });
      }

      const [document] = await sequelize.query(
        `SELECT * FROM Documents WHERE id = :documentId`,
        { replacements: { documentId }, type: sequelize.QueryTypes.SELECT, transaction }
      );
      if (!document) {
        await transaction.rollback();
        return res.status(404).json({ message: "Document not found" });
      }

      // Delete from Firebase
      const fileName = document.firebaseUrl.split("/").pop();
      await admin.storage().bucket().file(`Uploads/${fileName}`).delete().catch(() => {});

      await sequelize.query(
        `DELETE FROM Documents WHERE id = :documentId`,
        { replacements: { documentId }, type: sequelize.QueryTypes.DELETE, transaction }
      );
      
      req.body._deletedData = report.toJSON();

      await transaction.commit();
      res.status(200).json({ message: "Document deleted successfully" });
    } catch (err) {
      await transaction.rollback();
      console.error("Delete document error:", err);
      res.status(500).json({ message: "Failed to delete document", details: err.message });
    }
  },
};
