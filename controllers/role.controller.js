// controllers/role.controller.js
const { sequelize, Role, Permission, User } = require("../models");
const { Op } = require("sequelize");

// ---------------------------------------------------------------------
// Helper: validate that every permission name actually exists
// ---------------------------------------------------------------------
const validatePermissionNames = async (names, transaction) => {
  if (!Array.isArray(names) || names.length === 0) return [];

  const existing = await Permission.findAll({
    where: { name: { [Op.in]: names } },
    attributes: ["name"],
    transaction,
  });

  const existingNames = existing.map((p) => p.name);
  const invalid = names.filter((n) => !existingNames.includes(n));

  if (invalid.length > 0) {
    throw new Error(`Invalid permission(s): ${invalid.join(", ")}`);
  }
  return existingNames;
};

// ---------------------------------------------------------------------
// CREATE ROLE
// ---------------------------------------------------------------------
exports.createRole = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { name, permissionNames = [] } = req.body;

    if (!name?.trim()) {
      await t.rollback();
      return res.status(400).json({ error: "Role name is required" });
    }

    const exists = await Role.findOne({ where: { name }, transaction: t });
    if (exists) {
      await t.rollback();
      return res.status(409).json({ error: "Role name already exists" });
    }

    const validPermissions = await validatePermissionNames(permissionNames, t);

    const role = await Role.create(
      { name: name.trim(), permissions: validPermissions },
      { transaction: t }
    );

    await t.commit();
    return res.status(201).json({ role });
  } catch (err) {
    await t.rollback();
    console.error("createRole error:", err);
    return res
      .status(400)
      .json({ error: err.message || "Failed to create role" });
  }
};

// ---------------------------------------------------------------------
// GET ALL ROLES (with permission details)
// ---------------------------------------------------------------------
exports.getAllRoles = async (req, res) => {
  try {
    const roles = await Role.findAll({
      attributes: ["id", "name", "permissions", "createdAt", "updatedAt"],
      order: [["name", "ASC"]],
    });

    const permissionIds = new Set();
    roles.forEach((r) => r.permissions.forEach((p) => permissionIds.add(p)));

    const permissionMap = await Permission.findAll({
      where: { name: { [Op.in]: Array.from(permissionIds) } },
      attributes: ["name", "description"],
    }).then((perms) =>
      perms.reduce((map, p) => {
        map[p.name] = p.description;
        return map;
      }, {})
    );

    const enriched = roles.map((r) => ({
      ...r.toJSON(),
      permissionsDetail: r.permissions.map((p) => ({
        name: p,
        description: permissionMap[p] || null,
      })),
    }));

    return res.json({ roles: enriched });
  } catch (err) {
    console.error("getAllRoles error:", err);
    return res.status(500).json({ error: "Failed to fetch roles" });
  }
};

// ---------------------------------------------------------------------
// GET SINGLE ROLE
// ---------------------------------------------------------------------
exports.getRoleById = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await Role.findByPk(id, {
      attributes: ["id", "name", "permissions", "createdAt", "updatedAt"],
    });

    if (!role) return res.status(404).json({ error: "Role not found" });

    const permissionMap = await Permission.findAll({
      where: { name: { [Op.in]: role.permissions } },
      attributes: ["name", "description"],
    }).then((perms) =>
      perms.reduce((map, p) => {
        map[p.name] = p.description;
        return map;
      }, {})
    );

    const enriched = {
      ...role.toJSON(),
      permissionsDetail: role.permissions.map((p) => ({
        name: p,
        description: permissionMap[p] || null,
      })),
    };

    return res.json({ role: enriched });
  } catch (err) {
    console.error("getRoleById error:", err);
    return res.status(500).json({ error: "Failed to fetch role" });
  }
};

// ---------------------------------------------------------------------
// UPDATE ROLE – USING RAW SQL
// ---------------------------------------------------------------------
exports.updateRole = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { name, permissionNames = [] } = req.body;

    // 1. Verify role exists
    const [roleExists] = await sequelize.query(
      `SELECT id, name FROM Roles WHERE id = :id`,
      {
        replacements: { id },
        type: sequelize.QueryTypes.SELECT,
        transaction: t,
      }
    );

    if (!roleExists) {
      await t.rollback();
      return res.status(404).json({ error: "Role not found" });
    }

    // 2. Validate new name (if provided) – uniqueness
    if (name && name.trim() !== roleExists.name) {
      const [duplicate] = await sequelize.query(
        `SELECT id FROM Roles WHERE name = :name AND id != :id LIMIT 1`,
        {
          replacements: { name: name.trim(), id },
          type: sequelize.QueryTypes.SELECT,
          transaction: t,
        }
      );

      if (duplicate) {
        await t.rollback();
        return res.status(409).json({ error: "Role name already taken" });
      }
    }

    // 3. Validate permission names
    const validPermissions = await validatePermissionNames(permissionNames, t);

    // 4. Build JSON string for PostgreSQL/MySQL
    const permissionsJson = JSON.stringify(validPermissions);

    // 5. Raw UPDATE
    await sequelize.query(
      `UPDATE Roles 
       SET name = :name, 
           permissions = :permissions,
           updatedAt = NOW()
       WHERE id = :id`,
      {
        replacements: {
          name: name ? name.trim() : roleExists.name,
          permissions: permissionsJson,
          id,
        },
        type: sequelize.QueryTypes.UPDATE,
        transaction: t,
      }
    );

    // 6. Return fresh data
    const [updated] = await sequelize.query(
      `SELECT id, name, permissions, createdAt, updatedAt FROM Roles WHERE id = :id`,
      {
        replacements: { id },
        type: sequelize.QueryTypes.SELECT,
        transaction: t,
      }
    );

    await t.commit();

    // Enrich with descriptions
    const permissionMap = await Permission.findAll({
      where: { name: { [Op.in]: updated.permissions } },
      attributes: ["name", "description"],
    }).then((perms) =>
      perms.reduce((map, p) => {
        map[p.name] = p.description;
        return map;
      }, {})
    );

    const enriched = {
      ...updated,
      permissionsDetail: updated.permissions.map((p) => ({
        name: p,
        description: permissionMap[p] || null,
      })),
    };

    return res.json({ role: enriched });
  } catch (err) {
    await t.rollback();
    console.error("updateRole error:", err);
    return res
      .status(400)
      .json({ error: err.message || "Failed to update role" });
  }
};

// ---------------------------------------------------------------------
// DELETE ROLE (only if no users are attached)
// ---------------------------------------------------------------------
exports.deleteRole = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;

    const role = await Role.findByPk(id, { transaction: t });
    if (!role) {
      await t.rollback();
      return res.status(404).json({ error: "Role not found" });
    }

    const users = await User.findAll({
      include: [{ model: Role, where: { id }, required: true }],
      limit: 1,
      transaction: t,
    });

    if (users.length > 0) {
      await t.rollback();
      return res
        .status(400)
        .json({ error: "Cannot delete role – it is assigned to one or more users" });
    }

    await role.destroy({ transaction: t });
    await t.commit();
    return res.json({ message: "Role deleted successfully" });
  } catch (err) {
    await t.rollback();
    console.error("deleteRole error:", err);
    return res.status(500).json({ error: "Failed to delete role" });
  }
};

// ---------------------------------------------------------------------
// GET ALL PERMISSIONS (for UI)
// ---------------------------------------------------------------------
exports.getAllPermissions = async (req, res) => {
  try {
    const perms = await Permission.findAll({
      attributes: ["id", "name", "description"],
      order: [["name", "ASC"]],
    });
    return res.json({ permissions: perms });
  } catch (err) {
    console.error("getAllPermissions error:", err);
    return res.status(500).json({ error: "Failed to fetch permissions" });
  }
};
