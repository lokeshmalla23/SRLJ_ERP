/**
 * Built-in catalog masters that must always exist.
 * Survive factory wipe via ensureSystemCatalogItems() on every seed/boot.
 * Codes match ProductForm / billing expectations (GOLD, g, pc, …).
 */
import { Op } from 'sequelize';
import { CatalogItem } from '../models/index.js';
import { newId } from '../utils.js';

/** Canonical system rows. `aliases` match older seed / free-typed codes. */
export const SYSTEM_CATALOG_ITEMS = [
  {
    type: 'metal_type',
    code: 'GOLD',
    name: 'Gold',
    color: '#B49042',
    aliases: ['gold'],
  },
  {
    type: 'metal_type',
    code: 'SILVER',
    name: 'Silver',
    color: '#9CA3AF',
    aliases: ['silver'],
  },
  {
    type: 'unit',
    code: 'g',
    name: 'Grams',
    aliases: ['gram', 'grams'],
  },
  {
    type: 'unit',
    code: 'pc',
    name: 'Piece',
    aliases: ['piece', 'pcs'],
  },
  {
    type: 'unit',
    code: 'tray',
    name: 'Tray',
    aliases: ['tray'],
  },
  {
    type: 'purity',
    code: '18K',
    name: '18K',
    metal_code: 'GOLD',
    aliases: ['18k'],
  },
  {
    type: 'purity',
    code: '22K',
    name: '22K',
    metal_code: 'GOLD',
    aliases: ['22k', '22K BIS916'],
  },
  {
    type: 'purity',
    code: '24K',
    name: '24K',
    metal_code: 'GOLD',
    aliases: ['24k'],
  },
  {
    type: 'purity',
    code: '999',
    name: 'Pure 999',
    metal_code: 'SILVER',
    aliases: ['999'],
  },
  {
    type: 'purity',
    code: '925',
    name: 'Sterling Silver 925',
    metal_code: 'SILVER',
    aliases: ['925', 'S925', 's925'],
  },
];

const SYSTEM_CODE_KEYS = new Set(
  SYSTEM_CATALOG_ITEMS.flatMap((item) => {
    const codes = [item.code, ...(item.aliases || [])];
    return codes.map((c) => `${item.type}:${String(c).toUpperCase()}`);
  }),
);

export function isSystemCatalogSpec(type, code) {
  if (!type || code == null || code === '') return false;
  return SYSTEM_CODE_KEYS.has(`${type}:${String(code).toUpperCase()}`);
}

function uniqueCodes(codes) {
  const seen = new Set();
  const out = [];
  for (const raw of codes) {
    const c = String(raw || '').trim();
    if (!c) continue;
    const key = c.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c, c.toLowerCase(), c.toUpperCase());
  }
  return [...new Set(out)];
}

/**
 * Ensure Gold/Silver, Grams/Piece/Tray, and standard purities exist and are marked is_system.
 * Idempotent — safe after factory reset and on every boot.
 */
export async function ensureSystemCatalogItems(shopId = null, { transaction } = {}) {
  const byMetalCode = {};

  for (const spec of SYSTEM_CATALOG_ITEMS.filter((s) => s.type === 'metal_type')) {
    byMetalCode[spec.code] = await upsertSystemItem(spec, shopId, {}, { transaction });
  }

  for (const spec of SYSTEM_CATALOG_ITEMS.filter((s) => s.type === 'unit')) {
    await upsertSystemItem(spec, shopId, {}, { transaction });
  }

  for (const spec of SYSTEM_CATALOG_ITEMS.filter((s) => s.type === 'purity')) {
    const metal = byMetalCode[spec.metal_code];
    const meta = metal?.id ? { metal_type_id: metal.id } : {};
    await upsertSystemItem(spec, shopId, meta, { transaction });
  }
}

async function upsertSystemItem(spec, shopId, metaExtra, { transaction } = {}) {
  const codes = uniqueCodes([spec.code, ...(spec.aliases || [])]);
  let row = await CatalogItem.findOne({
    where: {
      type: spec.type,
      deleted_at: null,
      code: { [Op.in]: codes },
    },
    transaction,
  });

  if (!row) {
    const candidates = await CatalogItem.findAll({
      where: { type: spec.type, deleted_at: null },
      transaction,
    });
    const wantName = String(spec.name).trim().toLowerCase();
    const aliasNames = new Set([
      wantName,
      ...codes.map((c) => String(c).trim().toLowerCase()),
    ]);
    // Also accept "Gram" for Grams, "Sterling 925" for Sterling Silver 925
    if (spec.code === 'g') aliasNames.add('gram');
    if (spec.code === '925') {
      aliasNames.add('sterling 925');
      aliasNames.add('sterling silver 925');
    }
    if (spec.code === '999') aliasNames.add('pure 999');
    row = candidates.find((c) => aliasNames.has(String(c.name || '').trim().toLowerCase())) || null;
  }

  if (!row) {
    return CatalogItem.create({
      id: newId(),
      shop_id: shopId || null,
      type: spec.type,
      name: spec.name,
      code: spec.code,
      color: spec.color || null,
      description: null,
      meta: metaExtra || {},
      is_system: true,
    }, { transaction });
  }

  const updates = {};
  if (!row.is_system) updates.is_system = true;
  if (String(row.code || '') !== spec.code) updates.code = spec.code;
  if (String(row.name || '') !== spec.name) updates.name = spec.name;
  if (spec.color && row.color !== spec.color) updates.color = spec.color;

  if (metaExtra?.metal_type_id) {
    const prev = typeof row.meta === 'object' && row.meta ? row.meta : {};
    if (prev.metal_type_id !== metaExtra.metal_type_id) {
      updates.meta = { ...prev, ...metaExtra };
    }
  }

  if (Object.keys(updates).length > 0) {
    await row.update(updates, { transaction });
  }
  return row;
}
