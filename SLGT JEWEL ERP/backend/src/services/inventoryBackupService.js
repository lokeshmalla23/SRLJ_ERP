/**
 * Inventory-only backup (stock + catalog) — Settings → Backup & Export.
 *
 * Scope (intentionally narrow — this is the INVENTORY module's backup):
 *   - products              (catalog fields + current stock quantities)
 *   - categories            (full tree, code prefixes, defaults, counters)
 *   - catalog_items         (metal types, purities, units, collections, tags, stone types)
 *   - attributes            (custom product attribute definitions)
 *   - shop_counters         (physical showcase counters)
 *   - inventory_movements   (the authoritative stock ledger)
 *
 * NOT included: customers, invoices, vendors, expenses, employees, schemes,
 * settings — those belong to their own modules / the full-database backup.
 *
 * Restore is transactional: either the whole file applies or nothing does.
 */
import { Op } from 'sequelize';
import sequelize from '../db.js';
import {
  Product, Category, CatalogItem, Attribute, ShopCounter, InventoryMovement, Shop, Vendor,
} from '../models/index.js';
import { newId } from '../utils.js';
import { getDefaultShopId } from './defaultShop.js';
import { appendEventLog } from './eventLogService.js';
import branchConfig from '../config/branchConfig.js';
import { createMatcher } from './backupMatch.js';

export const INVENTORY_BACKUP_FORMAT = 'slgt-jewel-erp/inventory-backup';
export const INVENTORY_BACKUP_VERSION = 1;

const COLLECTION_KEYS = ['shop_counters', 'catalog_items', 'categories', 'attributes', 'products', 'inventory_movements'];

/**
 * JSONB columns per collection.
 *
 * SQLite has no JSONB, so Sequelize writes correct JSON text but reads it back
 * as a raw *string* — while its setter JSON.stringifies whatever it is given.
 * Handing it the string we read would therefore double-encode the value (and
 * an array column read back as a string would be dropped by Array.isArray).
 * Normalise to a real value on the way out of the DB and on the way back in.
 */
const JSON_COLUMNS = {
  shop_counters: [],
  catalog_items: ['meta'],
  categories: [],
  attributes: ['options', 'category_ids'],
  products: ['collection_ids', 'tag_ids', 'stone_type_ids', 'attribute_values', 'stone_details'],
  inventory_movements: ['meta'],
};

function parseJsonCol(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizeJsonCols(row, jsonCols) {
  if (!jsonCols.length || !row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const col of jsonCols) out[col] = parseJsonCol(out[col]);
  return out;
}

const toRows = (list, jsonCols) => list.map((r) => normalizeJsonCols(r.toJSON(), jsonCols));
const asArray = (v) => (Array.isArray(v) ? v : []);

function invalid(message) {
  const err = new Error(message);
  err.code = 'INVENTORY_BACKUP_INVALID';
  return err;
}

// createMatcher lives in ./backupMatch.js and is shared with the customer
// backup restore.

// ─── Export ──────────────────────────────────────────────────────────────────

export async function buildInventoryBackup() {
  const [catalogItems, categories, attributes, counters, products, movements] = await Promise.all([
    CatalogItem.findAll({ order: [['type', 'ASC'], ['name', 'ASC']] }),
    Category.findAll({ order: [['parent_id', 'ASC'], ['name', 'ASC']] }),
    Attribute.findAll({ order: [['code', 'ASC']] }),
    ShopCounter.findAll({ order: [['name', 'ASC']] }),
    Product.findAll({ order: [['name', 'ASC']] }),
    InventoryMovement.findAll({ order: [['created_at', 'ASC']] }),
  ]);

  return {
    format: INVENTORY_BACKUP_FORMAT,
    version: INVENTORY_BACKUP_VERSION,
    scope: 'inventory',
    exported_at: new Date().toISOString(),
    counts: {
      products: products.length,
      categories: categories.length,
      catalog_items: catalogItems.length,
      attributes: attributes.length,
      shop_counters: counters.length,
      inventory_movements: movements.length,
    },
    // Import order — parents before children.
    shop_counters: toRows(counters, JSON_COLUMNS.shop_counters),
    catalog_items: toRows(catalogItems, JSON_COLUMNS.catalog_items),
    categories: toRows(categories, JSON_COLUMNS.categories),
    attributes: toRows(attributes, JSON_COLUMNS.attributes),
    products: toRows(products, JSON_COLUMNS.products),
    inventory_movements: toRows(movements, JSON_COLUMNS.inventory_movements),
  };
}

// ─── Import ──────────────────────────────────────────────────────────────────

function normalizePayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalid('The selected file is not a valid inventory backup.');
  }
  if (raw.format !== INVENTORY_BACKUP_FORMAT) {
    throw invalid('The selected file is not an inventory backup. Use a file created by "Inventory backup" in Settings → Backup & Export.');
  }
  if (!Number.isFinite(Number(raw.version)) || Number(raw.version) > INVENTORY_BACKUP_VERSION) {
    throw invalid('This inventory backup was created by a newer version of the ERP. Update the app first.');
  }
  const out = {};
  for (const key of COLLECTION_KEYS) {
    out[key] = asArray(raw[key]).map((row) => normalizeJsonCols(row, JSON_COLUMNS[key]));
  }
  return out;
}

/**
 * Restore an inventory backup. Applies catalog masters first, then products,
 * then the stock ledger, remapping every foreign key through id maps so the
 * file restores cleanly into a database with different internal ids.
 */
export async function restoreInventoryBackup(rawPayload, { userId = null } = {}) {
  const data = normalizePayload(rawPayload);
  const defaultShopId = await getDefaultShopId();

  // Source shops that still exist here keep their id; anything else (fresh
  // install, different machine) is remapped onto the default shop.
  const sourceShopIds = new Set(
    [...data.shop_counters, ...data.catalog_items, ...data.categories, ...data.attributes, ...data.products]
      .map((r) => r.shop_id)
      .filter(Boolean),
  );
  const knownShops = sourceShopIds.size
    ? new Set((await Shop.findAll({ where: { id: { [Op.in]: [...sourceShopIds] } } })).map((s) => s.id))
    : new Set();
  const resolveShop = (sid) => (sid && knownShops.has(sid) ? sid : defaultShopId);

  const summary = {
    products: 0,
    categories: 0,
    catalog_items: 0,
    attributes: 0,
    shop_counters: 0,
    inventory_movements: 0,
    movements_replaced: 0,
    movements_skipped: 0,
  };

  await sequelize.transaction(async (transaction) => {
    // 1 ── Shop counters (products + categories point at these) ──────────────
    const counterMap = new Map();
    const existingCounters = await ShopCounter.findAll({ transaction });
    const matchCounter = createMatcher(
      existingCounters,
      (c) => [c.shop_id, c.name],
      (shopId, name) => `${shopId}|${name || ''}`,
      (shopId, name) => `${shopId}|${(name || '').toLowerCase()}`,
    );
    const usedCounterIds = new Set(existingCounters.map((c) => c.id));

    for (const src of data.shop_counters) {
      try {
        const shopId = resolveShop(src.shop_id);
        const payload = {
          name: src.name,
          code: src.code ?? null,
          device_id: src.device_id ?? null,
          is_default: Boolean(src.is_default),
          status: src.status || 'active',
          shop_id: shopId,
          deleted_at: src.deleted_at ?? null,
        };
        let target = matchCounter(shopId, src.name);
        if (target) {
          await target.update(payload, { transaction });
        } else {
          const id = src.id && !usedCounterIds.has(src.id) ? src.id : newId();
          target = await ShopCounter.create({ id, ...payload }, { transaction });
          usedCounterIds.add(target.id);
        }
        if (src.id) counterMap.set(src.id, target.id);
        summary.shop_counters += 1;
      } catch (err) {
        err.message = `Shop counter "${src.name || src.id}" — ${err.message}`;
        err.code = 'INVENTORY_BACKUP_RESTORE_FAILED';
        throw err;
      }
    }

    // 2 ── Catalog items (metals, purities, units, collections, tags, stones) ─
    const catalogMap = new Map();
    const existingCatalog = await CatalogItem.findAll({ transaction });
    const matchCatalog = createMatcher(
      existingCatalog,
      (c) => [c.shop_id, c.type, c.name],
      (shopId, type, name) => `${shopId}|${type}|${name || ''}`,
      (shopId, type, name) => `${shopId}|${type}|${(name || '').toLowerCase()}`,
    );
    const usedCatalogIds = new Set(existingCatalog.map((c) => c.id));

    for (const src of data.catalog_items) {
      try {
        const shopId = resolveShop(src.shop_id);
        const payload = {
          type: src.type,
          name: src.name,
          code: src.code ?? null,
          description: src.description ?? null,
          color: src.color ?? null,
          meta: src.meta,
          shop_id: shopId,
          deleted_at: src.deleted_at ?? null,
        };
        let target = matchCatalog(shopId, src.type, src.name);
        if (target) {
          // Seeded masters (Gold/Silver, Grams/Piece/Tray) stay system-owned.
          if (src.is_system && !target.is_system) payload.is_system = true;
          await target.update(payload, { transaction });
        } else {
          const id = src.id && !usedCatalogIds.has(src.id) ? src.id : newId();
          target = await CatalogItem.create({ id, ...payload, is_system: Boolean(src.is_system) }, { transaction });
          usedCatalogIds.add(target.id);
        }
        if (src.id) catalogMap.set(src.id, target.id);
        summary.catalog_items += 1;
      } catch (err) {
        err.message = `Catalog item "${src.name || src.id}" — ${err.message}`;
        err.code = 'INVENTORY_BACKUP_RESTORE_FAILED';
        throw err;
      }
    }

    // 3 ── Categories (self-referencing — restore parents before children) ───
    const categoryMap = new Map();
    const existingCategories = await Category.findAll({ transaction });
    // parent keys are ids in *target* space on both sides, so they compare directly.
    const matchCategory = createMatcher(
      existingCategories,
      (c) => [c.shop_id, c.name, c.parent_id],
      (shopId, name, parentId) => `${shopId}|${name || ''}|${parentId || ''}`,
      (shopId, name, parentId) => `${shopId}|${(name || '').toLowerCase()}|${parentId || ''}`,
    );
    const usedCategoryIds = new Set(existingCategories.map((c) => c.id));
    const categoryIdsInFile = new Set(data.categories.map((c) => c.id).filter(Boolean));

    const restoreCategory = async (src, forceRoot = false) => {
      const shopId = resolveShop(src.shop_id);
      const parentSrcId = forceRoot ? null : (src.parent_id || null);
      const mappedParent = parentSrcId ? (categoryMap.get(parentSrcId) || null) : null;
      const payload = {
        name: src.name,
        description: src.description ?? null,
        parent_id: mappedParent,
        icon: src.icon ?? null,
        display_order: src.display_order ?? '0',
        code_prefix: src.code_prefix ?? null,
        default_metal_type_id: src.default_metal_type_id
          ? (catalogMap.get(src.default_metal_type_id) || null)
          : null,
        default_wastage_pct: src.default_wastage_pct ?? null,
        default_making_charge: src.default_making_charge ?? null,
        default_making_charge_type: src.default_making_charge_type ?? null,
        low_stock_threshold: src.low_stock_threshold ?? null,
        counter_id: src.counter_id ? (counterMap.get(src.counter_id) || null) : null,
        shop_id: shopId,
        deleted_at: src.deleted_at ?? null,
      };
      let target = matchCategory(shopId, src.name, mappedParent);
      if (target) {
        await target.update(payload, { transaction });
      } else {
        const id = src.id && !usedCategoryIds.has(src.id) ? src.id : newId();
        target = await Category.create({ id, ...payload }, { transaction });
        usedCategoryIds.add(target.id);
      }
      if (src.id) categoryMap.set(src.id, target.id);
      summary.categories += 1;
    };

    let pending = [...data.categories];
    let madeProgress = true;
    while (pending.length && madeProgress) {
      madeProgress = false;
      const stillPending = [];
      for (const src of pending) {
        const parentSrcId = src.parent_id || null;
        const parentWaiting = parentSrcId
          && !categoryMap.has(parentSrcId)
          && categoryIdsInFile.has(parentSrcId);
        if (parentWaiting) {
          stillPending.push(src);
          continue;
        }
        await restoreCategory(src);
        madeProgress = true;
      }
      pending = stillPending;
    }
    // Cycles / missing parents: fall back to restoring the rest as roots so
    // nothing in the file is silently dropped.
    for (const src of pending) {
      try {
        await restoreCategory(src, true);
      } catch (err) {
        err.message = `Category "${src.name || src.id}" — ${err.message}`;
        err.code = 'INVENTORY_BACKUP_RESTORE_FAILED';
        throw err;
      }
    }

    // 4 ── Attribute definitions (attribute_values is keyed by code) ─────────
    const existingAttrs = await Attribute.findAll({ transaction });
    const matchAttr = createMatcher(
      existingAttrs,
      (a) => [a.shop_id, a.code],
      (shopId, code) => `${shopId}|${code || ''}`,
      (shopId, code) => `${shopId}|${(code || '').toLowerCase()}`,
    );
    const usedAttrIds = new Set(existingAttrs.map((a) => a.id));

    for (const src of data.attributes) {
      try {
        const shopId = resolveShop(src.shop_id);
        const payload = {
          name: src.name,
          code: src.code,
          field_type: src.field_type || 'text',
          options: src.options == null ? src.options : asArray(src.options),
          required: Boolean(src.required),
          unit: src.unit ?? null,
          category_ids: src.category_ids == null ? null : asArray(src.category_ids)
            .map((cid) => categoryMap.get(cid))
            .filter(Boolean),
          display_order: src.display_order ?? 0,
          help_text: src.help_text ?? null,
          shop_id: shopId,
          deleted_at: src.deleted_at ?? null,
        };
        let target = matchAttr(shopId, src.code);
        if (target) {
          await target.update(payload, { transaction });
        } else {
          const id = src.id && !usedAttrIds.has(src.id) ? src.id : newId();
          target = await Attribute.create({ id, ...payload }, { transaction });
          usedAttrIds.add(target.id);
        }
        summary.attributes += 1;
      } catch (err) {
        err.message = `Attribute "${src.code || src.name || src.id}" — ${err.message}`;
        err.code = 'INVENTORY_BACKUP_RESTORE_FAILED';
        throw err;
      }
    }

    // 5 ── Products (catalog fields + stock quantities) ──────────────────────
    // Vendors are a separate module and are not part of this backup — keep the
    // link only when that vendor already exists here, otherwise detach it.
    const existingVendorIds = new Set(
      (await Vendor.findAll({ attributes: ['id'], transaction })).map((v) => v.id),
    );

    const productMap = new Map();
    const existingProducts = await Product.findAll({ transaction });
    const productById = new Map(existingProducts.map((p) => [p.id, p]));
    const matchProductBarcode = createMatcher(
      existingProducts.filter((p) => p.barcode),
      (p) => [p.shop_id, p.barcode],
      (shopId, barcode) => `${shopId}|${barcode}`,
      (shopId, barcode) => `${shopId}|${String(barcode).toLowerCase()}`,
    );
    const matchProductCode = createMatcher(
      existingProducts.filter((p) => p.code),
      (p) => [p.shop_id, p.code],
      (shopId, code) => `${shopId}|${code}`,
      (shopId, code) => `${shopId}|${String(code).toLowerCase()}`,
    );
    const usedProductIds = new Set(existingProducts.map((p) => p.id));

    const mapCatalogList = (ids) => (ids == null
      ? ids
      : asArray(ids).map((x) => catalogMap.get(x)).filter(Boolean));

    // Resolve every product's counterpart before writing anything, so a row
    // identified by barcode is never stolen from a later row by the weaker
    // code / id fallbacks.
    const resolvedProducts = data.products.map((src) => ({
      src,
      shopId: resolveShop(src.shop_id),
      target: null,
    }));
    const claimedProductIds = new Set();
    const claim = (hit) => { claimedProductIds.add(hit.id); return hit; };

    for (const item of resolvedProducts) {           // pass 1 — barcode (strongest)
      if (item.src.barcode) {
        const hit = matchProductBarcode(item.shopId, item.src.barcode);
        if (hit) item.target = claim(hit);
      }
    }
    for (const item of resolvedProducts) {           // pass 2 — code
      if (item.target || !item.src.code) continue;
      const hit = matchProductCode(item.shopId, item.src.code);
      if (hit) item.target = claim(hit);
    }
    for (const item of resolvedProducts) {           // pass 3 — source id
      if (item.target || !item.src.id) continue;
      const hit = productById.get(item.src.id);
      if (hit && !claimedProductIds.has(hit.id)) item.target = claim(hit);
    }

    for (const item of resolvedProducts) {
      const { src, shopId } = item;
      let target = item.target;
      try {
        const payload = {
          name: src.name,
          code: src.code ?? null,
          barcode: src.barcode ?? null,
          category_id: src.category_id ? (categoryMap.get(src.category_id) || null) : null,
          subcategory_id: src.subcategory_id ? (categoryMap.get(src.subcategory_id) || null) : null,
          collection_ids: mapCatalogList(src.collection_ids),
          tag_ids: mapCatalogList(src.tag_ids),
          metal_type_id: src.metal_type_id ? (catalogMap.get(src.metal_type_id) || null) : null,
          purity_id: src.purity_id ? (catalogMap.get(src.purity_id) || null) : null,
          stone_type_ids: mapCatalogList(src.stone_type_ids),
          unit_id: src.unit_id ? (catalogMap.get(src.unit_id) || null) : null,
          attribute_values: src.attribute_values,
          gross_weight: src.gross_weight ?? 0,
          net_weight: src.net_weight ?? 0,
          stone_weight: src.stone_weight ?? 0,
          making_charges: src.making_charges ?? 0,
          making_charge_type: src.making_charge_type ?? 'fixed',
          wastage_pct: src.wastage_pct ?? 0,
          hallmark: src.hallmark ?? null,
          hsn_code: src.hsn_code ?? null,
          gst_slab: src.gst_slab ?? 3,
          purchase_price: src.purchase_price ?? 0,
          selling_price: src.selling_price ?? 0,
          stock_qty: src.stock_qty ?? 0,
          low_stock_threshold: src.low_stock_threshold ?? 0,
          tray_total_weight: src.tray_total_weight ?? null,
          piece_weight: src.piece_weight ?? null,
          purchase_cost_per_gram: src.purchase_cost_per_gram ?? null,
          cal_code: src.cal_code ?? null,
          description: src.description ?? null,
          design_no: src.design_no ?? null,
          size: src.size ?? null,
          showcase_location: src.showcase_location ?? null,
          counter_id: src.counter_id ? (counterMap.get(src.counter_id) || null) : null,
          status: src.status || 'available',
          purchase_date: src.purchase_date ?? null,
          deleted_at: src.deleted_at ?? null,
          stone_details: src.stone_details == null ? src.stone_details : asArray(src.stone_details),
          certification: src.certification ?? null,
          vendor_id: src.vendor_id && existingVendorIds.has(src.vendor_id) ? src.vendor_id : null,
          inventory_mode: src.inventory_mode || 'quantity',
          shop_id: shopId,
        };

        if (target) {
          await target.update(payload, { transaction });
        } else {
          const id = src.id && !usedProductIds.has(src.id) ? src.id : newId();
          target = await Product.create({ id, ...payload }, { transaction });
          usedProductIds.add(target.id);
          productById.set(target.id, target);
        }
        if (src.id) productMap.set(src.id, target.id);
        summary.products += 1;
      } catch (err) {
        err.message = `Product "${src.barcode || src.code || src.name || src.id}" — ${err.message}`;
        err.code = 'INVENTORY_BACKUP_RESTORE_FAILED';
        throw err;
      }
    }

    // 6 ── Stock ledger ──────────────────────────────────────────────────────
    // Replace the ledger for every product this file carries, so the restored
    // qty_before/qty_after chain matches the restored stock instead of being
    // interleaved with history from before the restore.
    const targetProductIds = new Set(
      data.inventory_movements
        .map((m) => productMap.get(m.product_id))
        .filter(Boolean),
    );
    if (targetProductIds.size) {
      summary.movements_replaced = await InventoryMovement.destroy({
        where: { product_id: { [Op.in]: [...targetProductIds] } },
        transaction,
      }) || 0;
    }

    const movementRows = [];
    for (const src of data.inventory_movements) {
      const productId = productMap.get(src.product_id);
      if (!productId) {
        summary.movements_skipped += 1;
        continue;
      }
      movementRows.push({
        id: newId(),
        shop_id: resolveShop(src.shop_id),
        product_id: productId,
        movement_type: src.movement_type,
        quantity: src.quantity,
        gross_weight: src.gross_weight ?? 0,
        net_weight: src.net_weight ?? 0,
        stone_weight: src.stone_weight ?? 0,
        qty_before: src.qty_before ?? null,
        qty_after: src.qty_after ?? null,
        reference_type: src.reference_type ?? null,
        reference_id: src.reference_id ?? null,
        origin_device_id: src.origin_device_id ?? null,
        created_by: src.created_by ?? null,
        notes: src.notes ?? null,
        meta: src.meta ?? {}, // NOT NULL column
        created_at: src.created_at ? new Date(src.created_at) : new Date(),
      });
    }
    if (movementRows.length) {
      await InventoryMovement.bulkCreate(movementRows, { transaction });
      summary.inventory_movements = movementRows.length;
    }
  });

  // Its own transaction: the restore has already committed, and a cluster
  // event-log hiccup must never fail a completed restore. (appendEventLog
  // refuses to run without a transaction.)
  try {
    await sequelize.transaction((t) => appendEventLog({
      eventType: 'INVENTORY_BACKUP_RESTORED',
      entityType: 'inventory',
      originDeviceId: branchConfig.device_id,
      userId,
      critical: true,
      payload: { ...summary },
      transaction: t,
    }));
  } catch { /* cluster event log is optional — never fail a completed restore */ }

  return summary;
}
