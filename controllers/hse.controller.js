// controllers/hse.controller.js
const { HSEReport, User } = require("../models");
const { Op } = require("sequelize");

// Create HSE Report + Upload Doc
exports.createHSEReport = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { dateOfReport, timeOfReport, report } = req.body;
    const reporterId = req.user.id;
    const file = req.uploadedFiles?.[0]; // First file

    if (!dateOfReport || !timeOfReport || !report) {
      return res.status(400).json({ message: "dateOfReport, timeOfReport, and report are required" });
    }

    const hseReport = await HSEReport.create(
      {
        dateOfReport,
        timeOfReport,
        reporterId,
        report,
        supportingDocUrl: file?.firebaseUrl || null,
      },
      { transaction }
    );

    await transaction.commit();

    const fullReport = await HSEReport.findByPk(hseReport.id, {
      include: [{ model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] }],
    });

    res.status(201).json({
      message: "HSE report submitted successfully",
      hseReport: fullReport,
    });
  } catch (err) {
    await transaction.rollback();
    console.error("HSE create error:", err);
    res.status(500).json({ message: "Failed to submit HSE report", details: err.message });
  }
};

// Get All HSE Reports (Admin)
exports.getAllHSEReports = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "" } = req.query;
    const offset = (page - 1) * limit;

    const where = search
      ? {
          [Op.or]: [
            { report: { [Op.like]: `%${search}%` } },
            { "$reporter.firstName$": { [Op.like]: `%${search}%` } },
            { "$reporter.lastName$": { [Op.like]: `%${search}%` } },
          ],
        }
      : {};

    const { count, rows } = await HSEReport.findAndCountAll({
      where,
      include: [{ model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] }],
      order: [["dateOfReport", "DESC"], ["timeOfReport", "DESC"]],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      hseReports: rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("Get HSE reports error:", err);
    res.status(500).json({ error: "Failed to fetch HSE reports" });
  }
};
