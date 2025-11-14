// controllers/hseDocument.controller.js
const { Op } = require("sequelize");
const { HseDocument, User, HSEReport, sequelize } = require("../models");

// 🟢 CREATE DOCUMENT(S) — Multiple files supported
exports.createDocument = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { reportId } = req.body;
    const uploadedBy = req.user.id;

    if (!req.uploadedFiles || req.uploadedFiles.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: "No files uploaded" });
    }

    const docsToInsert = req.uploadedFiles.map((f) => ({
      name: f.originalname,
      firebaseUrls: JSON.stringify([f.firebaseUrl]), // array of URLs
      uploadedBy,
      reportId: reportId ? Number(reportId) : null,
      type: f.mimetype,
      size: f.size,
    }));

    const created = await HseDocument.bulkCreate(docsToInsert, { transaction: t });
    await t.commit();

    return res.status(201).json({ message: "Documents uploaded successfully", documents: created });
  } catch (err) {
    await t.rollback();
    console.error("createDocument error:", err);
    return res.status(500).json({ error: "Failed to save documents", details: err.message });
  }
};

// 🟡 GET ALL DOCUMENTS (with filters & pagination)
exports.getAllDocuments = async (req, res) => {
  try {
    const {
      search,
      type,
      reportId,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

    const offset = (page - 1) * limit;
    const where = {};

    if (type) where.type = type;
    if (reportId) where.reportId = reportId;
    if (search) where.name = { [Op.like]: `%${search}%` };
    if (startDate && endDate) {
      where.createdAt = { [Op.between]: [new Date(startDate), new Date(endDate)] };
    }

    const { count, rows } = await HseDocument.findAndCountAll({
      where,
      include: [
        { model: User, as: "uploader", attributes: ["id", "firstName", "lastName", "email"] },
        { model: HSEReport, as: "report", attributes: ["id", "title", "status"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return res.status(200).json({
      documents: rows,
      pagination: {
        totalItems: count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("getAllDocuments error:", err);
    return res.status(500).json({ error: "Failed to fetch documents" });
  }
};

// 🟣 GET SINGLE DOCUMENT
exports.getDocumentById = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await HseDocument.findOne({
      where: { id },
      include: [
        { model: User, as: "uploader", attributes: ["id", "firstName", "lastName", "email"] },
        { model: HSEReport, as: "report", attributes: ["id", "title", "status"] },
      ],
    });

    if (!document) return res.status(404).json({ message: "Document not found" });
    return res.status(200).json(document);
  } catch (err) {
    console.error("getDocumentById error:", err);
    return res.status(500).json({ error: "Failed to fetch document" });
  }
};

// 🟠 UPDATE DOCUMENT — Using RAW MySQL only
exports.updateDocument = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { name, type, size, reportId } = req.body || {};

    // 1. Lock row + get current data
    const [currentDoc] = await sequelize.query(
      `SELECT * FROM HseDocuments WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    if (!currentDoc) {
      await t.rollback();
      return res.status(404).json({ message: "Document not found" });
    }

    // Audit trail
    if (!req.body) req.body = {};
    req.body._previousData = currentDoc;

    // 2. Handle new file (if uploaded)
    let firebaseUrls = currentDoc.firebaseUrls;
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      const newFile = req.uploadedFiles[0];
      firebaseUrls = JSON.stringify([newFile.firebaseUrl]);

      // Optional: Delete old file from Firebase
      try {
        const oldUrl = JSON.parse(currentDoc.firebaseUrls)[0];
        const oldPath = oldUrl.split(`/o/`).pop().split("?")[0];
        await admin.storage().bucket().file(decodeURIComponent(oldPath)).delete();
      } catch (err) {
        console.warn("Failed to delete old file:", err.message);
      }
    }

    // 3. Build dynamic UPDATE query
    const updates = [];
    const replacements = { id };

    if (name !== undefined) {
      updates.push("name = :name");
      replacements.name = name;
    }
    if (type !== undefined) {
      updates.push("type = :type");
      replacements.type = type;
    }
    if (size !== undefined) {
      updates.push("size = :size");
      replacements.size = size;
    }
    if (reportId !== undefined) {
      updates.push("reportId = :reportId");
      replacements.reportId = reportId === "" ? null : Number(reportId);
    }
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      updates.push("firebaseUrls = :firebaseUrls");
      replacements.firebaseUrls = firebaseUrls;
    }

    if (updates.length === 0) {
      await t.commit();
      return res.status(200).json({ message: "No changes made", document: currentDoc });
    }

    updates.push("updatedAt = NOW()");

    await sequelize.query(
      `UPDATE HseDocuments SET ${updates.join(", ")} WHERE id = :id`,
      { replacements, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    // 4. Fetch updated document
    const [updatedDoc] = await sequelize.query(
      `SELECT * FROM HseDocuments WHERE id = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    await t.commit();
    return res.status(200).json({ message: "Document updated successfully", document: updatedDoc });
  } catch (err) {
    await t.rollback();
    console.error("updateDocument error:", err);
    return res.status(500).json({ error: "Failed to update document", details: err.message });
  }
};

// DELETE DOCUMENT
exports.deleteDocument = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    const doc = await HseDocument.findByPk(id, { transaction: t });
    if (!doc) {
      await t.rollback();
      return res.status(404).json({ message: "Document not found" });
    }

    // Audit
    if (!req.body) req.body = {};
    req.body._deletedData = doc.toJSON();

    // Delete file from Firebase
    try {
      const url = JSON.parse(doc.firebaseUrls)[0];
      const filePath = url.split(`/o/`).pop().split("?")[0];
      await admin.storage().bucket().file(decodeURIComponent(filePath)).delete();
    } catch (err) {
      console.warn("Failed to delete file from Firebase:", err.message);
    }

    await doc.destroy({ transaction: t });
    await t.commit();

    return res.status(200).json({ message: "Document deleted successfully" });
  } catch (err) {
    await t.rollback();
    console.error("deleteDocument error:", err);
    return res.status(500).json({ error: "Failed to delete document" });
  }
};
