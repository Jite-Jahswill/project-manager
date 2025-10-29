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

    // Prevent duplicate role name
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

    // Optionally enrich with permission descriptions
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

    // enrich permissions
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
// UPDATE ROLE (name + permissions)
// ---------------------------------------------------------------------
exports.updateRole = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { name, permissionNames = [] } = req.body;

    const role = await Role.findByPk(id, { transaction: t });
    if (!role) {
      await t.rollback();
      return res.status(404).json({ error: "Role not found" });
    }

    // If name changes, check uniqueness
    if (name && name.trim() !== role.name) {
      const duplicate = await Role.findOne({
        where: { name: name.trim(), id: { [Op.ne]: id } },
        transaction: t,
      });
      if (duplicate) {
        await t.rollback();
        return res.status(409).json({ error: "Role name already taken" });
      }
    }

    const validPermissions = await validatePermissionNames(permissionNames, t);

    await role.update(
      {
        name: name ? name.trim() : role.name,
        permissions: validPermissions,
      },
      { transaction: t }
    );

    await t.commit();
    return res.json({ role: await Role.findByPk(id) });
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

    // Check if any user has this role
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
