const { Op } = require("sequelize");
const { HseDocument, User, HSEReport } = require("../models");

// 🟢 Create new document
exports.createDocument = async (req, res) => {
  try {
    const { name, firebaseUrls, reportId, type, size } = req.body;
    const uploadedBy = req.user.id;

    if (!name || !firebaseUrls || !type || !size) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const newDoc = await HseDocument.create({
      name,
      firebaseUrls,
      uploadedBy,
      reportId: reportId || null,
      type,
      size,
    });

    return res.status(201).json(newDoc);
  } catch (err) {
    console.error("createDocument error:", err);
    return res.status(500).json({ error: "Failed to create document" });
  }
};

// 🟡 Get all documents (filter, search, date range)
exports.getAllDocuments = async (req, res) => {
  try {
    const { search, type, reportId, startDate, endDate, page = 1, limit = 20 } = req.query;
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
        {
          model: User,
          as: "uploader",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        {
          model: HSEReport,
          as: "report",
          attributes: ["id", "title", "status"],
        },
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

// 🟣 Get single document
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

// 🟠 Update document
exports.updateDocument = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { name, firebaseUrls, type, size, reportId } = req.body || {};

    // Ensure req.body exists for audit
    if (!req.body) req.body = {};

    // 1. FETCH CURRENT DOCUMENT (for audit + validation)
    const [doc] = await sequelize.query(
      `SELECT * FROM HseDocuments WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    if (!doc) {
      await t.rollback();
      return res.status(404).json({ message: "Document not found" });
    }

    // AUDIT: Capture old values
    req.body._previousData = doc;

    // 2. BUILD UPDATE FIELDS
    const updates = [];
    const replacements = { id };

    if (name !== undefined) {
      updates.push("name = :name");
      replacements.name = name;
    }
    if (firebaseUrls !== undefined) {
      updates.push("firebaseUrls = :firebaseUrls");
      replacements.firebaseUrls = JSON.stringify(firebaseUrls);
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
      replacements.reportId = reportId === null ? null : reportId;
    }

    // Only run update if something changed
    if (updates.length > 0) {
      await sequelize.query(
        `UPDATE HseDocuments 
         SET ${updates.join(", ")}, updatedAt = NOW() 
         WHERE id = :id`,
        { replacements, type: sequelize.QueryTypes.UPDATE, transaction: t }
      );
    }

    // 3. FETCH UPDATED DOCUMENT
    const [updatedDoc] = await sequelize.query(
      `SELECT * FROM HseDocuments WHERE id = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t }
    );

    await t.commit();
    return res.status(200).json({ message: "Document updated", document: updatedDoc });
  } catch (err) {
    await t.rollback();
    console.error("updateDocument error:", err);
    return res.status(500).json({ error: "Failed to update document" });
  }
};

// 🔴 Delete document
exports.deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.body) req.body = {};
    const doc = await HseDocument.findByPk(id);
    if (!doc) return res.status(404).json({ message: "Document not found" });
    req.body._deletedData = doc.toJSON();

    await doc.destroy();
    return res.status(200).json({ message: "Document deleted successfully" });
  } catch (err) {
    console.error("deleteDocument error:", err);
    return res.status(500).json({ error: "Failed to delete document" });
  }
};
