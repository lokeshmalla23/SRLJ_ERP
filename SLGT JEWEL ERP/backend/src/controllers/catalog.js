import { Op } from 'sequelize';
import { Category, Attribute, CatalogItem } from '../models/index.js';
import { newId, normalizeJsonFields, parseJsonField } from '../utils.js';
import sequelize from '../db.js';
import { QueryTypes } from 'sequelize';
import { isSystemCatalogSpec } from '../services/systemCatalog.js';

const attrJson = (row) => normalizeJsonFields(row?.toJSON ? row.toJSON() : row, {
  options: [],
  category_ids: [],
});

const catalogItemJson = (row) => normalizeJsonFields(row?.toJSON ? row.toJSON() : row, {
  meta: {},
});

// ─── Kind mapping (URL param → DB type) ──────────────────────────────────────
export const KIND_MAP = {
  collections: 'collection',
  tags: 'tag',
  'metal-types': 'metal_type',
  'stone-types': 'stone_type',
  purities: 'purity',
  units: 'unit',
};

// ──────────────────────────────────────────────────────────────────────────────
// CATEGORIES
// ──────────────────────────────────────────────────────────────────────────────

// GET /api/categories
export const listCategories = async (req, res, next) => {
  try {
    const { include_tree, parent_id } = req.query;
    const where = { deleted_at: null };
    if (parent_id !== undefined) {
      where.parent_id = parent_id === 'null' ? null : parent_id;
    }

    const all = await Category.findAll({ where, order: [['display_order', 'ASC'], ['name', 'ASC']] });

    if (include_tree === 'true' && !parent_id) {
      // Build tree: top-level + children — also collapse duplicate parent names
      const parentsRaw = all.filter((c) => !c.parent_id);
      const children = all.filter((c) => c.parent_id);
      const byName = new Map();
      for (const p of parentsRaw) {
        const key = String(p.name || '').trim().toUpperCase();
        const prev = byName.get(key);
        if (!prev) {
          byName.set(key, p);
          continue;
        }
        const score = (x) => (x.code_prefix ? 100 : 0) + children.filter((c) => c.parent_id === x.id).length;
        if (score(p) > score(prev)) byName.set(key, p);
      }
      const parents = [...byName.values()];

      // Sum product stock_qty per sub-category (pieces in stock under that sub-category)
      const stockRows = await sequelize.query(
        `SELECT subcategory_id AS id,
                COALESCE(SUM(CAST(stock_qty AS REAL)), 0) AS stock_qty,
                COUNT(*) AS product_count
         FROM products
         WHERE deleted_at IS NULL AND subcategory_id IS NOT NULL
         GROUP BY subcategory_id`,
        { type: QueryTypes.SELECT },
      );
      const stockBySub = new Map(
        (stockRows || []).map((r) => [r.id, { stock_qty: Number(r.stock_qty) || 0, product_count: Number(r.product_count) || 0 }]),
      );

      const tree = parents.map((p) => {
        const kids = children.filter((c) => c.parent_id === p.id);
        const kidByName = new Map();
        for (const k of kids) {
          const key = String(k.name || '').trim().toUpperCase();
          if (!kidByName.has(key)) kidByName.set(key, k);
        }
        return {
          ...p.toJSON(),
          children: [...kidByName.values()].map((c) => {
            const json = c.toJSON();
            const stock = stockBySub.get(c.id) || { stock_qty: 0, product_count: 0 };
            const threshold = json.low_stock_threshold != null ? Number(json.low_stock_threshold) : null;
            return {
              ...json,
              stock_qty: stock.stock_qty,
              product_count: stock.product_count,
              is_low_stock: threshold != null && threshold > 0 && stock.stock_qty <= threshold,
            };
          }),
        };
      });
      return res.json(tree);
    }

    return res.json(all.map((c) => c.toJSON()));
  } catch (err) {
    next(err);
  }
};

// Empty-string form fields must never reach a FLOAT column — Postgres rejects
// `''` for double precision ("invalid input syntax for type double precision").
const toNullableFloat = (v) => (v === '' || v == null ? null : Number(v));
// display_order is a free-form text sort key (may be alphanumeric, e.g. "A1") — default to '0' when blank.
const toDisplayOrder = (v) => (v === '' || v == null ? '0' : String(v));

// POST /api/categories
export const createCategory = async (req, res, next) => {
  try {
    const { name, description, parent_id, icon, display_order, code_prefix, default_metal_type_id, default_wastage_pct, default_making_charge, default_making_charge_type, low_stock_threshold, counter_id } = req.body;
    if (!name) return res.status(400).json({ detail: 'name is required' });

    const category = await Category.create({
      id: newId(),
      name,
      description,
      parent_id: parent_id || null,
      icon,
      display_order: toDisplayOrder(display_order),
      code_prefix: code_prefix || null,
      default_metal_type_id: default_metal_type_id || null,
      default_wastage_pct: toNullableFloat(default_wastage_pct),
      default_making_charge: toNullableFloat(default_making_charge),
      default_making_charge_type: default_making_charge_type || 'percentage',
      // Low-stock threshold is meaningful on sub-categories (parent_id set)
      low_stock_threshold: parent_id ? toNullableFloat(low_stock_threshold) : null,
      counter_id: counter_id || null,
    });
    return res.status(201).json(category.toJSON());
  } catch (err) {
    next(err);
  }
};

// PATCH /api/categories/:id
export const updateCategory = async (req, res, next) => {
  try {
    const cat = await Category.findByPk(req.params.id);
    if (!cat) return res.status(404).json({ detail: 'Category not found' });
    const updates = { ...req.body };
    if ('default_wastage_pct' in updates) updates.default_wastage_pct = toNullableFloat(updates.default_wastage_pct);
    if ('default_making_charge' in updates) updates.default_making_charge = toNullableFloat(updates.default_making_charge);
    if ('display_order' in updates) updates.display_order = toDisplayOrder(updates.display_order);
    if ('low_stock_threshold' in updates) {
      updates.low_stock_threshold = cat.parent_id
        ? toNullableFloat(updates.low_stock_threshold)
        : null;
    }
    if ('counter_id' in updates) {
      updates.counter_id = updates.counter_id || null;
    }
    await cat.update(updates);
    return res.json(cat.toJSON());
  } catch (err) {
    next(err);
  }
};

// DELETE /api/categories/:id
export const deleteCategory = async (req, res, next) => {
  try {
    const cat = await Category.findByPk(req.params.id);
    if (!cat) return res.status(404).json({ detail: 'Category not found' });
    await cat.destroy();
    return res.json({ message: 'Category deleted' });
  } catch (err) {
    next(err);
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// ATTRIBUTES
// ──────────────────────────────────────────────────────────────────────────────

// GET /api/attributes
export const listAttributes = async (req, res, next) => {
  try {
    const { category_id } = req.query;
    let all = await Attribute.findAll({ order: [['display_order', 'ASC']] });

    if (category_id) {
      all = all.filter((a) => {
        const ids = parseJsonField(a.category_ids, []);
        return Array.isArray(ids) && ids.includes(category_id);
      });
    }

    return res.json(all.map((a) => attrJson(a)));
  } catch (err) {
    next(err);
  }
};

// GET /api/attributes/for-product
export const listAttributesForProduct = async (req, res, next) => {
  try {
    const { category_id, subcategory_id } = req.query;
    let all = await Attribute.findAll({ order: [['display_order', 'ASC']] });

    const targetIds = [category_id, subcategory_id].filter(Boolean);
    if (targetIds.length > 0) {
      all = all.filter((a) => {
        const ids = parseJsonField(a.category_ids, []);
        return Array.isArray(ids) && targetIds.some((tid) => ids.includes(tid));
      });
    }

    return res.json(all.map((a) => attrJson(a)));
  } catch (err) {
    next(err);
  }
};

// POST /api/attributes
export const createAttribute = async (req, res, next) => {
  try {
    const { name, code, field_type, options, required, unit, category_ids, display_order, help_text } = req.body;
    if (!name || !code) return res.status(400).json({ detail: 'name and code are required' });

    const attr = await Attribute.create({
      id: newId(),
      name,
      code,
      field_type: field_type || 'text',
      options: options || [],
      required: required || false,
      unit,
      category_ids: category_ids || [],
      display_order: display_order || 0,
      help_text,
    });
    return res.status(201).json(attr.toJSON());
  } catch (err) {
    next(err);
  }
};

// PATCH /api/attributes/:id
export const updateAttribute = async (req, res, next) => {
  try {
    const attr = await Attribute.findByPk(req.params.id);
    if (!attr) return res.status(404).json({ detail: 'Attribute not found' });
    await attr.update(req.body);
    return res.json(attr.toJSON());
  } catch (err) {
    next(err);
  }
};

// DELETE /api/attributes/:id
export const deleteAttribute = async (req, res, next) => {
  try {
    const attr = await Attribute.findByPk(req.params.id);
    if (!attr) return res.status(404).json({ detail: 'Attribute not found' });
    await attr.destroy();
    return res.json({ message: 'Attribute deleted' });
  } catch (err) {
    next(err);
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// CATALOG LOOKUPS  (collections | tags | metal-types | stone-types | purities | units)
// ──────────────────────────────────────────────────────────────────────────────

// GET /api/catalog/:kind
export const listCatalogKind = async (req, res, next) => {
  try {
    const dbType = KIND_MAP[req.params.kind];
    if (!dbType) return res.status(400).json({ detail: `Unknown catalog kind: ${req.params.kind}` });

    const items = await CatalogItem.findAll({
      where: { type: dbType, deleted_at: null },
      order: [['name', 'ASC']],
    });
    // Collapse seed+Neon duplicates (same type+code, different ids)
    const byCode = new Map();
    for (const row of items) {
      const j = catalogItemJson(row);
      const key = String(j.code || j.name || j.id).toUpperCase();
      const prev = byCode.get(key);
      if (!prev) {
        byCode.set(key, j);
        continue;
      }
      // Prefer system masters over duplicates
      if (j.is_system && !prev.is_system) {
        byCode.set(key, j);
        continue;
      }
      if (prev.is_system && !j.is_system) continue;
      const prevMeta = typeof prev.meta === 'object' ? prev.meta : {};
      const nextMeta = typeof j.meta === 'object' ? j.meta : {};
      if (nextMeta?.metal_type_id && !prevMeta?.metal_type_id) byCode.set(key, j);
      else if (String(j.name || '').length > String(prev.name || '').length) byCode.set(key, j);
    }
    return res.json([...byCode.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))));
  } catch (err) {
    next(err);
  }
};

// POST /api/catalog/:kind
export const createCatalogItem = async (req, res, next) => {
  try {
    const dbType = KIND_MAP[req.params.kind];
    if (!dbType) return res.status(400).json({ detail: `Unknown catalog kind: ${req.params.kind}` });

    const { name, code, description, color, meta } = req.body;
    if (!name) return res.status(400).json({ detail: 'name is required' });

    const item = await CatalogItem.create({
      id: newId(),
      type: dbType,
      name,
      code,
      description,
      color,
      meta: meta || {},
    });
    return res.status(201).json(catalogItemJson(item));
  } catch (err) {
    next(err);
  }
};

// PATCH /api/catalog/:kind/:id
export const updateCatalogItem = async (req, res, next) => {
  try {
    const dbType = KIND_MAP[req.params.kind];
    if (!dbType) return res.status(400).json({ detail: `Unknown catalog kind: ${req.params.kind}` });

    const item = await CatalogItem.findOne({ where: { id: req.params.id, type: dbType } });
    if (!item) return res.status(404).json({ detail: 'Item not found' });

    const protectedRow = item.is_system || isSystemCatalogSpec(dbType, item.code);
    if (protectedRow) {
      // Allow name/description/color/meta edits; lock type/code/is_system.
      const { type, code, is_system, ...safe } = req.body || {};
      if (code != null && String(code) !== String(item.code || '')) {
        return res.status(403).json({ detail: 'System catalog code cannot be changed' });
      }
      await item.update(safe);
    } else {
      await item.update(req.body);
    }
    return res.json(catalogItemJson(item));
  } catch (err) {
    next(err);
  }
};

// DELETE /api/catalog/:kind/:id
export const deleteCatalogItem = async (req, res, next) => {
  try {
    const dbType = KIND_MAP[req.params.kind];
    if (!dbType) return res.status(400).json({ detail: `Unknown catalog kind: ${req.params.kind}` });

    const item = await CatalogItem.findOne({ where: { id: req.params.id, type: dbType } });
    if (!item) return res.status(404).json({ detail: 'Item not found' });

    if (item.is_system || isSystemCatalogSpec(dbType, item.code)) {
      return res.status(403).json({
        detail: 'This is a system catalog item and cannot be deleted',
      });
    }

    await item.destroy();
    return res.json({ message: 'Item deleted' });
  } catch (err) {
    next(err);
  }
};
