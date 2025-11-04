const { Op } = require("sequelize");
const { HSEReport, HseDocument, User } = require("../models");

// 🟢 Create new HSE report
exports.createReport = async (req, res) => {
  try {
    const { dateOfReport, timeOfReport, report, firebaseUrls } = req.body;
    const reporterId = req.user.id;

    if (!dateOfReport || !timeOfReport || !report) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const newReport = await HSEReport.create({
      dateOfReport,
      timeOfReport,
      report,
      reporterId,
      firebaseUrls: firebaseUrls || [],
    });

    return res.status(201).json({
      message: "Report created successfully",
      report: newReport,
    });
  } catch (err) {
    console.error("createReport error:", err);
    return res.status(500).json({ error: "Failed to create report" });
  }
};

// 🟡 Get all reports (filter, search, date range)
exports.getAllReports = async (req, res) => {
  try {
    const { status, search, startDate, endDate, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const where = {};

    if (status) where.status = status;
    if (search) where.report = { [Op.like]: `%${search}%` };
    if (startDate && endDate) {
      where.dateOfReport = { [Op.between]: [startDate, endDate] };
    }

    const { count, rows } = await HSEReport.findAndCountAll({
      where,
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName", "email"] },
        {
          model: HseDocument,
          as: "documents",
          attributes: ["id", "name", "firebaseUrls", "type", "size", "createdAt"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return res.status(200).json({
      reports: rows,
      pagination: {
        totalItems: count,
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (err) {
    console.error("getAllReports error:", err);
    return res.status(500).json({ error: "Failed to fetch reports" });
  }
};

// 🟣 Get single report by ID
exports.getReportById = async (req, res) => {
  try {
    const { id } = req.params;

    const report = await HSEReport.findOne({
      where: { id },
      include: [
        { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
        { model: User, as: "closer", attributes: ["id", "firstName", "lastName", "email"] },
        {
          model: HseDocument,
          as: "documents",
          attributes: ["id", "name", "firebaseUrls", "type", "size", "createdAt"],
        },
      ],
    });

    if (!report) return res.status(404).json({ message: "Report not found" });
    return res.status(200).json(report);
  } catch (err) {
    console.error("getReportById error:", err);
    return res.status(500).json({ error: "Failed to fetch report" });
  }
};

// 🟠 Update HSE report
exports.updateReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { dateOfReport, timeOfReport, report, firebaseUrls, status, closedBy } = req.body;

    const existing = await HSEReport.findByPk(id);
    if (!existing) return res.status(404).json({ message: "Report not found" });

    await existing.update({
      dateOfReport: dateOfReport ?? existing.dateOfReport,
      timeOfReport: timeOfReport ?? existing.timeOfReport,
      report: report ?? existing.report,
      firebaseUrls: firebaseUrls ?? existing.firebaseUrls,
      status: status ?? existing.status,
      closedBy: closedBy ?? existing.closedBy,
      closedAt: status === "closed" ? new Date() : existing.closedAt,
    });

    return res.status(200).json({ message: "Report updated", report: existing });
  } catch (err) {
    console.error("updateReport error:", err);
    return res.status(500).json({ error: "Failed to update report" });
  }
};

// 🔴 Delete report
exports.deleteReport = async (req, res) => {
  try {
    const { id } = req.params;

    const report = await HSEReport.findByPk(id);
    if (!report) return res.status(404).json({ message: "Report not found" });

    await report.destroy();
    return res.status(200).json({ message: "Report deleted successfully" });
  } catch (err) {
    console.error("deleteReport error:", err);
    return res.status(500).json({ error: "Failed to delete report" });
  }
};
