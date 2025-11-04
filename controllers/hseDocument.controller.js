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
  try {
    const { id } = req.params;
    const { name, firebaseUrls, type, size, reportId } = req.body;

    const doc = await HseDocument.findByPk(id);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    await doc.update({
      name: name ?? doc.name,
      firebaseUrls: firebaseUrls ?? doc.firebaseUrls,
      type: type ?? doc.type,
      size: size ?? doc.size,
      reportId: reportId ?? doc.reportId,
    });

    return res.status(200).json(doc);
  } catch (err) {
    console.error("updateDocument error:", err);
    return res.status(500).json({ error: "Failed to update document" });
  }
};

// 🔴 Delete document
exports.deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await HseDocument.findByPk(id);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    await doc.destroy();
    return res.status(200).json({ message: "Document deleted successfully" });
  } catch (err) {
    console.error("deleteDocument error:", err);
    return res.status(500).json({ error: "Failed to delete document" });
  }
};
