// controllers/hseReports.controller.js
const { sequelize } = require("../models");

exports.getHseAnalytics = async (req, res) => {
  try {
    // 1. INCIDENT SUMMARY
    const [incidentSummary] = await sequelize.query(`
      SELECT 
        COUNT(*) as totalIncidents,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as openIncidents,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingIncidents,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closedIncidents
      FROM HSEReports;
    `);

    // 2. HIGH RISK COUNT
    const [highRisk] = await sequelize.query(`
      SELECT COUNT(*) as highRisks
      FROM Risks
      WHERE severity IN ('High', 'Critical');
    `);

    // 3. TRAINING COMPLIANCE
    const [trainingStats] = await sequelize.query(`
      SELECT 
        COUNT(*) as totalTrainings,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completedTrainings,
        ROUND(
          COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0)
        ) as compliancePercentage,
        SUM(CASE WHEN status = 'Urgent' 
            OR (nextTrainingDate < CURDATE() AND status != 'Completed') 
        THEN 1 ELSE 0 END) as overdueTrainings
      FROM Trainings;
    `);

    // 4. UPCOMING AUDITS
    const [upcomingAudits] = await sequelize.query(`
      SELECT COUNT(*) as upcomingAudits
      FROM Auditors
      WHERE date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY);
    `);

    // 5. MONTHLY INCIDENT TREND
    const [monthlyTrend] = await sequelize.query(`
      SELECT 
        DATE_FORMAT(createdAt, '%Y-%m') as month,
        COUNT(*) as incidents
      FROM HSEReports
      WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY DATE_FORMAT(createdAt, '%Y-%m')
      ORDER BY month;
    `);

    // 6. TOP 5 HAZARDS
    const [topHazards] = await sequelize.query(`
      SELECT hazard, COUNT(*) as count
      FROM Risks
      GROUP BY hazard
      ORDER BY count DESC
      LIMIT 5;
    `);

    // ==== RESPONSE ====

    res.json({
      success: true,
      data: {
        incidents: {
          total: Number(incidentSummary[0]?.totalIncidents || 0),
          open: Number(incidentSummary[0]?.openIncidents || 0),
          pending: Number(incidentSummary[0]?.pendingIncidents || 0),
          closed: Number(incidentSummary[0]?.closedIncidents || 0),
        },
        risks: {
          highRiskCount: Number(highRisk[0]?.highRisks || 0),
          topHazards: topHazards.map(h => ({
            hazard: h.hazard,
            count: Number(h.count)
          }))
        },
        training: {
          total: Number(trainingStats[0]?.totalTrainings || 0),
          completed: Number(trainingStats[0]?.completedTrainings || 0),
          compliancePercentage: Number(trainingStats[0]?.compliancePercentage || 0),
          overdue: Number(trainingStats[0]?.overdueTrainings || 0),
        },
        audits: {
          upcomingThisWeek: Number(upcomingAudits[0]?.upcomingAudits || 0)
        },
        trends: {
          monthlyIncidents: monthlyTrend.map(t => ({
            month: t.month,
            incidents: Number(t.incidents)
          }))
        }
      },
      generatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error("HSE Analytics Error:", err);
    res.status(500).json({ success: false, error: "Failed to generate HSE report" });
  }
};
