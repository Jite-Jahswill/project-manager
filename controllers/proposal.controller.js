// controllers/proposal.controller.js
const { Proposal, User, sequelize } = require("../models");
const sendMail = require("../utils/mailer");

// CREATE / SAVE DRAFT
exports.createOrUpdateProposal = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id, title, clientName, value, currency = "USD", description, validUntil, status = "Draft" } = req.body;
    const userId = req.user.id;

    let proposal;

    if (id) {
      // Update existing (only if still Draft or Submitted)
      [proposal] = await sequelize.query(
        `UPDATE Proposals 
         SET title = :title, clientName = :clientName, value = :value, currency = :currency,
             description = :description, validUntil = :validUntil, status = :status, updatedAt = NOW()
         WHERE id = :id AND submittedBy = :userId AND status IN ('Draft', 'Submitted')
         RETURNING *`,
        { replacements: { id, title, clientName, value, currency, description, validUntil, status, userId }, type: sequelize.QueryTypes.UPDATE, transaction: t }
      );
      if (!proposal || proposal.length === 0) throw new Error("Proposal not found or cannot be edited");
      proposal = proposal[0];
    } else {
      // Create new
      proposal = await Proposal.create({
        title, clientName, value, currency, description, validUntil,
        status, submittedBy: userId
      }, { transaction: t });
    }

    await t.commit();
    res.status(id ? 200 : 201).json(proposal);
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// SUBMIT FOR APPROVAL (changes status to Submitted)
exports.submitProposal = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await sequelize.query(
      `UPDATE Proposals SET status = 'Submitted', updatedAt = NOW() WHERE id = :id AND submittedBy = :userId AND status = 'Draft'`,
      { replacements: { id, userId }, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    const [updated] = await sequelize.query(`SELECT * FROM Proposals WHERE id = :id`, {
      replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t
    });

    if (!updated) {
      await t.rollback();
      return res.status(400).json({ message: "Cannot submit – already processed or not yours" });
    }

    await t.commit();

    // Notify managers
    // await sendMail({
    //   to: "management@company.com",
    //   subject: `New Proposal Submitted: ${updated.proposalId} – ${updated.title}`,
    //   html: `<h3>Proposal Awaiting Approval</h3>
    //          <p><strong>ID:</strong> ${updated.proposalId}</p>
    //          <p><strong>Title:</strong> ${updated.title}</p>
    //          <p><strong>Client:</strong> ${updated.clientName}</p>
    //          <p><strong>Value:</strong> ${updated.currency} ${parseFloat(updated.value).toLocaleString()}</p>
    //          <p><strong>Submitted by:</strong> ${req.user.firstName} ${req.user.lastName}</p>`
    // });

    res.json({ message: "Proposal submitted for approval", proposal: updated });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// APPROVE / REJECT / MARK WON/LOST (Manager only)
exports.updateProposalStatus = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { status } = req.body; // Approved, Rejected, Won, Lost
    const userId = req.user.id;

    const validStatuses = ["Approved", "Approved", "Rejected", "Won", "Lost"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await sequelize.query(
      `UPDATE Proposals 
       SET status = :status, approvedBy = :userId, approvedAt = NOW(), updatedAt = NOW()
       WHERE id = :id AND status = 'Submitted'`,
      { replacements: { id, status, userId }, type: sequelize.QueryTypes.UPDATE, transaction: t }
    );

    const [updated] = await sequelize.query(`SELECT * FROM Proposals WHERE id = :id`, {
      replacements: { id }, type: sequelize.QueryTypes.SELECT, transaction: t
    });

    if (!updated) {
      await t.rollback();
      return res.status(404).json({ message: "Proposal not found or not in Submitted state" });
    }

    await t.commit();

    // const author = await User.findByPk(updated.submittedBy);
    // await sendMail({
    //   to: author.email,
    //   subject: `Proposal ${status}: ${updated.proposalId}`,
    //   html: `<h3>Your proposal has been ${status.toUpperCase()}</h3>
    //          <p><strong>Title: ${updated.title}</p>
    //          <p>Value: ${updated.currency} ${parseFloat(updated.value).toLocaleString()}</p>`
    // });

    res.json({ message: `Proposal ${status.toLowerCase()}`, proposal: updated });
  } catch (err) {
    await t.rollback();
    res.status(500).json({ error: err.message });
  }
};

// ADD THESE TO YOUR EXISTING proposal.controller.js

// GET SINGLE PROPOSAL BY ID
exports.getProposalById = async (req, res) => {
  try {
    const { id } = req.params;
    const [proposal] = await sequelize.query(
      `SELECT p.*, 
              u1.firstName AS authorFirstName, u1.lastName AS authorLastName,
              u2.firstName AS approverFirstName, u2.lastName AS approverLastName
       FROM Proposals p
       LEFT JOIN Users u1 ON p.submittedBy = u1.id
       LEFT JOIN Users u2 ON p.approvedBy = u2.id
       WHERE p.id = :id`,
      { replacements: { id }, type: sequelize.QueryTypes.SELECT }
    );

    if (!proposal) return res.status(404).json({ message: "Proposal not found" });
    res.json(proposal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// FULLY SEARCHABLE GET ALL
exports.getAllProposals = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let where = [];
    let reps = { limit: parseInt(limit), offset };

    if (search) {
      where.push(`(p.title LIKE :search OR p.clientName LIKE :search OR p.proposalId LIKE :search)`);
      reps.search = `%${search}%`;
    }
    if (status) {
      where.push(`p.status = :status`);
      reps.status = status;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const [proposals, [{ total }]] = await Promise.all([
      sequelize.query(
        `SELECT p.*, 
                u1.firstName AS authorFirstName, u1.lastName AS authorLastName,
                u2.firstName AS approverFirstName, u2.lastName AS approverLastName
         FROM Proposals p
         LEFT JOIN Users u1 ON p.submittedBy = u1.id
         LEFT JOIN Users u2 ON p.approvedBy = u2.id
         ${whereClause}
         ORDER BY p.createdAt DESC
         LIMIT :limit OFFSET :offset`,
        { replacements: reps, type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(*) as total FROM Proposals p ${whereClause}`,
        { replacements: reps, type: sequelize.QueryTypes.SELECT }
      )
    ]);

    res.json({
      proposals,
      pagination: {
        total: Number(total),
        page: parseInt(page),
        totalPages: Math.ceil(total / limit),
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE PROPOSAL (only Draft or Rejected)
exports.deleteProposal = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // First: find the proposal to check ownership + status
    const proposal = await Proposal.findOne({
      where: {
        id,
        submittedBy: userId,
        status: ["Draft", "Rejected"]  // Only allow delete if Draft or Rejected
      },
      transaction: t
    });

    if (!proposal) {
      await t.rollback();
      return res.status(403).json({
        message: "Cannot delete: Proposal not found, not yours, or already processed"
      });
    }

    // Now safely delete
    await proposal.destroy({ transaction: t });
    await t.commit();

    res.json({
      message: "Proposal deleted successfully",
      deleted: {
        id: proposal.id,
        proposalId: proposal.proposalId,
        title: proposal.title
      }
    });
  } catch (err) {
    await t.rollback();
    console.error("Delete proposal error:", err);
    res.status(500).json({ error: "Failed to delete proposal" });
  }
};
