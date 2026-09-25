/**
 * CSV import for customers / products (matches Backup & Export column labels).
 */
import { Op } from 'sequelize';
import { Customer, Product, Vendor, Employee, Quotation, Expense, Category, CatalogItem } from '../models/index.js';
import { newId, nextShopSerial } from '../utils.js';
import { getDefaultShopId } from './defaultShop.js';
import { appendEventLog } from './eventLogService.js';
import { recordMovement } from './inventoryService.js';
import { INVENTORY_MODES, MOVEMENT_TYPES } from '../constants/inventory.js';
import branchConfig from '../config/branchConfig.js';
import sequelize from '../db.js';
import { roundWeight } from '../utils/weight.js';
import { parseCsv } from '../../../shared/domain/csvParse.js';

const VALID_PRODUCT_STATUSES = new Set([
  'available', 'sold', 'reserved', 'on_display', 'discontinued', 'damaged', 'deleted', 'deleted_p', 'estimation',
]);

const PRODUCT_STATUS_ALIASES = {
  available: 'available',
  'on display': 'on_display',
  on_display: 'on_display',
  ondisplay: 'on_display',
  reserved: 'reserved',
  estimation: 'estimation',
  damaged: 'damaged',
  sold: 'sold',
  'sold out': 'sold',
  discontinued: 'discontinued',
  deleted: 'deleted',
  'deleted p': 'deleted_p',
  deleted_p: 'deleted_p',
  deletedp: 'deleted_p',
};

/**
 * Name -> id resolver for Category/Sub-category (parent_id null vs set) and
 * CatalogItem (metal_type / purity), scoped to the shop. All rows are loaded
 * once per import and the in-memory map is extended as new names get
 * auto-created, so a CSV can reference a brand-new category/metal/purity by
 * name without the user having to pre-create it in Catalog first.
 */
async function makeNameResolver(shopId) {
  const [categories, catalogItems] = await Promise.all([
    Category.findAll({ where: { shop_id: shopId } }),
    CatalogItem.findAll({ where: { shop_id: shopId, type: { [Op.in]: ['metal_type', 'purity'] } } }),
  ]);
  const catByKey = new Map(categories.map((c) => [`${(c.name || '').toLowerCase()}|${c.parent_id || ''}`, c.id]));
  const catalogByKey = new Map(catalogItems.map((c) => [`${c.type}|${(c.name || '').toLowerCase()}`, c.id]));

  async function resolveCategory(name, { parentId = null, transaction } = {}) {
    if (!name) return null;
    const key = `${name.toLowerCase()}|${parentId || ''}`;
    if (catByKey.has(key)) return catByKey.get(key);
    try {
      const created = await Category.create({
        id: newId(), shop_id: shopId, name, parent_id: parentId,
      }, { transaction });
      catByKey.set(key, created.id);
      return created.id;
    } catch (err) {
      const found = await Category.findOne({
        where: {
          shop_id: shopId,
          name,
          parent_id: parentId || null,
        },
        transaction,
      });
      if (found) {
        catByKey.set(key, found.id);
        return found.id;
      }
      throw err;
    }
  }

  async function resolveCatalogItem(type, name, { transaction } = {}) {
    if (!name) return null;
    const key = `${type}|${name.toLowerCase()}`;
    if (catalogByKey.has(key)) return catalogByKey.get(key);
    try {
      const created = await CatalogItem.create({
        id: newId(), shop_id: shopId, type, name,
      }, { transaction });
      catalogByKey.set(key, created.id);
      return created.id;
    } catch (err) {
      const found = await CatalogItem.findOne({
        where: { shop_id: shopId, type, name },
        transaction,
      });
      if (found) {
        catalogByKey.set(key, found.id);
        return found.id;
      }
      throw err;
    }
  }

  return { resolveCategory, resolveCatalogItem };
}

export { parseCsv };

function pick(row, ...names) {
  for (const n of names) {
    if (row[n] != null && String(row[n]).trim() !== '') return String(row[n]).trim();
  }
  // case-insensitive fallback
  const keys = Object.keys(row);
  for (const n of names) {
    const found = keys.find((k) => k.toLowerCase() === n.toLowerCase());
    if (found && String(row[found]).trim() !== '') return String(row[found]).trim();
  }
  return '';
}

function num(val, fallback = 0) {
  if (val == null || val === '') return fallback;
  const n = Number(String(val).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve one field from a CSV row, without ever silently wiping data on an
 * update: a blank cell means "leave it as-is" when updating an existing
 * record (returns undefined, which the caller strips before .update()), and
 * falls back to a sane default only when creating a brand-new record.
 */
function fieldOrKeep(row, labels, { existing, parse = (v) => v, fallback = null } = {}) {
  const raw = pick(row, ...labels);
  if (raw === '') return existing ? undefined : fallback;
  return parse(raw);
}

export const CUSTOMER_TEMPLATE_CSV = [
  'Name,Mobile,Email,Address,GST Number,Tag,Total Purchases,Date of Birth,Anniversary,Notes',
  '"Sample Customer","9876543210","sample@email.com","Shop Street","","regular","0","","",""',
].join('\r\n');

export const PRODUCT_TEMPLATE_CSV = [
  'Product Name,Code,Barcode,Design No,Category,Sub Category,Metal,Purity,Hallmark,Certification,HSN Code,GST %,Gross Weight (g),Net Weight (g),Stone Weight (g),Making Charges,Making Charge Type,Wastage %,Purchase Price,Selling Price,Stock Qty,Low Stock Threshold,Status,Showcase Location',
  '"Gold Ring 22K","GR-001","TAG001","","Rings","","Gold","22K","","","7113","3","5.200","5.000","0.200","500","fixed","2","0","0","1","0","available",""',
].join('\r\n');

export async function importCustomersCsv(csvText, { userId = null, updateExisting = true } = {}) {
  const { rows } = parseCsv(csvText);
  if (!rows.length) {
    return { created: 0, updated: 0, skipped: 0, errors: [{ row: 0, detail: 'No data rows found' }] };
  }

  const shopId = await getDefaultShopId();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  await sequelize.transaction(async (transaction) => {
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const line = idx + 2; // header is line 1
      try {
        const name = pick(row, 'Name', 'name', 'Customer Name');
        const mobile = pick(row, 'Mobile', 'mobile', 'Phone');
        if (!name || !mobile) {
          skipped += 1;
          errors.push({ row: line, detail: 'Name and Mobile are required' });
          continue;
        }

        const payload = {
          name,
          mobile,
          email: pick(row, 'Email', 'email') || null,
          address: pick(row, 'Address', 'address') || null,
          gst_number: pick(row, 'GST Number', 'gst_number', 'GSTIN') || null,
          tag: pick(row, 'Tag', 'tag') || 'regular',
          total_purchases: num(pick(row, 'Total Purchases', 'total_purchases'), 0),
          dob: pick(row, 'Date of Birth', 'dob') || null,
          anniversary: pick(row, 'Anniversary', 'anniversary') || null,
          notes: pick(row, 'Notes', 'notes') || null,
          shop_id: shopId,
        };

        const existing = await Customer.findOne({
          where: { shop_id: shopId, mobile },
          transaction,
        });

        let customer;
        if (existing) {
          if (!updateExisting) {
            skipped += 1;
            continue;
          }
          await existing.update(payload, { transaction });
          customer = existing;
          updated += 1;
        } else {
          customer = await Customer.create({
            id: newId(),
            serial_no: await nextShopSerial(Customer, shopId, transaction),
            ...payload,
          }, { transaction });
          created += 1;
        }

        try {
          await appendEventLog({
            eventType: 'CUSTOMER_UPSERTED',
            entityType: 'customer',
            entityId: customer.id,
            originDeviceId: branchConfig.device_id,
            userId,
            critical: false,
            payload: { customer: customer.toJSON() },
            transaction,
          });
        } catch { /* cluster optional */ }
      } catch (err) {
        skipped += 1;
        errors.push({ row: line, detail: err.message || 'Import failed' });
      }
    }
  });

  return { created, updated, skipped, errors: errors.slice(0, 50), total_rows: rows.length };
}

function normalizeProductRows(csvTextOrRows) {
  if (Array.isArray(csvTextOrRows)) return csvTextOrRows.filter((row) => row && typeof row === 'object');
  return parseCsv(csvTextOrRows).rows;
}

function resolveProductName(row) {
  return pick(
    row,
    'Product Name', 'name', 'Name',
    'subcategory_name', 'Sub Category', 'SubCategory',
    'category_name', 'Category',
    'code', 'Code',
    'barcode', 'Barcode', 'Tag',
  );
}

function resolveProductStatus(row, existing) {
  const raw = pick(row, 'Status', 'status').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!raw) return existing ? undefined : 'available';
  const compact = raw.replace(/\s+/g, '_');
  const aliased = PRODUCT_STATUS_ALIASES[raw] || PRODUCT_STATUS_ALIASES[compact];
  if (aliased) return aliased;
  if (VALID_PRODUCT_STATUSES.has(compact)) return compact;
  return existing ? undefined : 'available';
}

export async function importProductsCsv(csvTextOrRows, { userId = null, updateExisting = true } = {}) {
  const rows = normalizeProductRows(csvTextOrRows);
  if (!rows.length) {
    return { created: 0, updated: 0, skipped: 0, errors: [{ row: 0, detail: 'No data rows found' }], total_rows: 0 };
  }

  const shopId = await getDefaultShopId();
  const { resolveCategory, resolveCatalogItem } = await makeNameResolver(shopId);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  // One transaction per row so a single bad tag (duplicate barcode, constraint
  // error) cannot abort and roll back the whole file — SQLite poisons the
  // outer transaction after any failed statement.
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const line = idx + 2;
    try {
      const name = resolveProductName(row);
      if (!name) {
        skipped += 1;
        errors.push({ row: line, detail: 'Product Name is required (or Sub Category / Code / Barcode)' });
        continue;
      }

      const code = pick(row, 'Code', 'code') || null;
      const barcode = pick(row, 'Barcode', 'barcode', 'Tag') || null;

      const outcome = await sequelize.transaction(async (transaction) => {
        let existing = null;
        if (barcode) {
          existing = await Product.findOne({ where: { shop_id: shopId, barcode }, transaction });
        }
        if (!existing && code) {
          existing = await Product.findOne({ where: { shop_id: shopId, code }, transaction });
        }
        if (existing && !updateExisting) {
          return 'skipped';
        }

        const field = (labels, opts) => fieldOrKeep(row, labels, { existing, ...opts });

        const categoryName = pick(row, 'Category', 'category_name');
        const subCategoryName = pick(row, 'Sub Category', 'SubCategory', 'subcategory_name');
        const metalName = pick(row, 'Metal', 'metal_name');
        const purityName = pick(row, 'Purity', 'purity_name', 'purity_code');
        const categoryId = categoryName
          ? await resolveCategory(categoryName, { transaction })
          : (existing ? undefined : null);
        const subcategoryId = subCategoryName
          ? await resolveCategory(subCategoryName, {
            parentId: categoryId ?? existing?.category_id ?? null,
            transaction,
          })
          : (existing ? undefined : null);
        const metalTypeId = metalName
          ? await resolveCatalogItem('metal_type', metalName, { transaction })
          : (existing ? undefined : null);
        const purityId = purityName
          ? await resolveCatalogItem('purity', purityName, { transaction })
          : (existing ? undefined : null);

        const payload = {
          name,
          code: field(['Code', 'code'], { fallback: code }),
          barcode: field(['Barcode', 'barcode', 'Tag'], { fallback: barcode }),
          design_no: field(['Design No', 'design_no']),
          category_id: categoryId,
          subcategory_id: subcategoryId,
          metal_type_id: metalTypeId,
          purity_id: purityId,
          hallmark: field(['Hallmark', 'hallmark']),
          certification: field(['Certification', 'certification']),
          hsn_code: field(['HSN Code', 'hsn_code']),
          showcase_location: field(['Showcase Location', 'showcase_location']),
          status: resolveProductStatus(row, existing),
          gst_slab: field(['GST %', 'gst_slab', 'GST'], { parse: (v) => num(v, 3), fallback: 3 }),
          gross_weight: field(['Gross Weight (g)', 'gross_weight', 'Gross Weight'], { parse: (v) => roundWeight(num(v, 0)), fallback: 0 }),
          net_weight: field(['Net Weight (g)', 'net_weight', 'Net Weight'], { parse: (v) => roundWeight(num(v, 0)), fallback: 0 }),
          stone_weight: field(['Stone Weight (g)', 'stone_weight', 'Stone Weight'], { parse: (v) => roundWeight(num(v, 0)), fallback: 0 }),
          making_charges: field(['Making Charges', 'making_charges'], { parse: (v) => num(v, 0), fallback: 0 }),
          making_charge_type: field(['Making Charge Type', 'making_charge_type'], { fallback: 'fixed' }),
          wastage_pct: field(['Wastage %', 'wastage_pct'], { parse: (v) => num(v, 0), fallback: 0 }),
          purchase_price: field(['Purchase Price', 'purchase_price'], { parse: (v) => num(v, 0), fallback: 0 }),
          selling_price: field(['Selling Price', 'selling_price'], { parse: (v) => num(v, 0), fallback: 0 }),
          stock_qty: field(['Stock Qty', 'stock_qty'], { parse: (v) => num(v, 0), fallback: 0 }),
          low_stock_threshold: field(['Low Stock Threshold', 'low_stock_threshold'], { parse: (v) => num(v, 0), fallback: 0 }),
          shop_id: shopId,
        };
        if (!existing) {
          const qty = payload.stock_qty == null ? 0 : Number(payload.stock_qty);
          payload.inventory_mode = barcode && (qty === 0 || qty === 1)
            ? INVENTORY_MODES.UNIQUE_TAG
            : INVENTORY_MODES.QUANTITY;
        }
        for (const k of Object.keys(payload)) {
          if (payload[k] === undefined) delete payload[k];
        }

        let product;
        const wasCreate = !existing;
        if (existing) {
          await existing.update(payload, { transaction });
          product = existing;
        } else {
          product = await Product.create({ id: newId(), ...payload }, { transaction });
          const openingQty = Number(product.stock_qty) || 0;
          if (openingQty !== 0 || product.inventory_mode === INVENTORY_MODES.UNIQUE_TAG) {
            await recordMovement({
              shopId,
              product,
              movementType: MOVEMENT_TYPES.OPENING,
              quantity: openingQty,
              qtyBefore: 0,
              qtyAfter: openingQty,
              referenceType: 'csv_import',
              referenceId: product.id,
              createdBy: userId || null,
              notes: 'Opening balance from inventory CSV import',
              transaction,
            });
          }
        }

        try {
          await sequelize.transaction({ transaction }, async (nested) => {
            await appendEventLog({
              eventType: 'PRODUCT_UPSERTED',
              entityType: 'product',
              entityId: product.id,
              originDeviceId: branchConfig.device_id,
              userId,
              critical: false,
              payload: { product: product.toJSON(), imported: true, created: wasCreate },
              transaction: nested,
            });
          });
        } catch { /* cluster event log is optional — do not lose the product */ }
        return wasCreate ? 'created' : 'updated';
      });
      if (outcome === 'created') created += 1;
      else if (outcome === 'updated') updated += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      const msg = String(err.message || '');
      const tag = pick(row, 'Barcode', 'barcode', 'Tag') || pick(row, 'Code', 'code') || '';
      const detail = /unique|barcode/i.test(msg) && tag
        ? `This product has already been added. Tag ${tag} cannot be added.`
        : (err.message || 'Import failed');
      errors.push({ row: line, detail });
    }
  }

  return { created, updated, skipped, errors: errors.slice(0, 50), total_rows: rows.length };
}

export const VENDOR_TEMPLATE_CSV = [
  'Vendor Name,Type,Contact Person,Mobile,Email,Address,GST Number,PAN Number,Outstanding Balance,Total Purchases,Status',
  '"Gold Supplier Co","gold_supplier","Ravi","9876500001","","Hyderabad","","","0","0","active"',
].join('\r\n');

export const EMPLOYEE_TEMPLATE_CSV = [
  'Name,Mobile,Email,Job Title,Department,Salary,Join Date,Status,Address,Emergency Contact',
  '"Cashier One","9876500002","","Cashier","Sales","15000","2026-01-01","active","",""',
].join('\r\n');

export const QUOTATION_TEMPLATE_CSV = [
  'Quote No,Customer Name,Mobile,Email,Gold Rate,Subtotal,Discount,GST %,GST Amount,Grand Total,Valid Until,Status,Notes',
  '"Q-1001","Walk-in","9876500003","","7000","50000","0","3","1500","51500","2026-08-15","draft","Imported quote"',
].join('\r\n');

export const EXPENSE_TEMPLATE_CSV = [
  'Date,Description,Category,Amount,Payment Mode,Reference,Notes',
  '"2026-07-01","Shop rent","Rent","25000","bank","","July rent"',
].join('\r\n');

export async function importVendorsCsv(csvText, { updateExisting = true } = {}) {
  const { rows } = parseCsv(csvText);
  if (!rows.length) {
    return { created: 0, updated: 0, skipped: 0, errors: [{ row: 0, detail: 'No data rows found' }] };
  }
  const shopId = await getDefaultShopId();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  await sequelize.transaction(async (transaction) => {
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const line = idx + 2;
      try {
        const name = pick(row, 'Vendor Name', 'name', 'Name');
        if (!name) {
          skipped += 1;
          errors.push({ row: line, detail: 'Vendor Name is required' });
          continue;
        }
        const mobile = pick(row, 'Mobile', 'mobile') || null;
        const payload = {
          name,
          type: pick(row, 'Type', 'type') || 'gold_supplier',
          contact_person: pick(row, 'Contact Person', 'contact_person') || null,
          mobile,
          email: pick(row, 'Email', 'email') || null,
          address: pick(row, 'Address', 'address') || null,
          gst_number: pick(row, 'GST Number', 'gst_number') || null,
          pan_number: pick(row, 'PAN Number', 'pan_number') || null,
          outstanding_balance: num(pick(row, 'Outstanding Balance', 'outstanding_balance'), 0),
          total_purchases: num(pick(row, 'Total Purchases', 'total_purchases'), 0),
          status: pick(row, 'Status', 'status') || 'active',
          shop_id: shopId,
        };

        let existing = null;
        if (mobile) {
          existing = await Vendor.findOne({ where: { shop_id: shopId, mobile }, transaction });
        }
        if (!existing) {
          existing = await Vendor.findOne({ where: { shop_id: shopId, name }, transaction });
        }

        if (existing) {
          if (!updateExisting) { skipped += 1; continue; }
          await existing.update(payload, { transaction });
          updated += 1;
        } else {
          await Vendor.create({ id: newId(), ...payload }, { transaction });
          created += 1;
        }
      } catch (err) {
        skipped += 1;
        errors.push({ row: line, detail: err.message || 'Import failed' });
      }
    }
  });

  return { created, updated, skipped, errors: errors.slice(0, 50), total_rows: rows.length };
}

export async function importEmployeesCsv(csvText, { updateExisting = true } = {}) {
  const { rows } = parseCsv(csvText);
  if (!rows.length) {
    return { created: 0, updated: 0, skipped: 0, errors: [{ row: 0, detail: 'No data rows found' }] };
  }
  const shopId = await getDefaultShopId();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  await sequelize.transaction(async (transaction) => {
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const line = idx + 2;
      try {
        const name = pick(row, 'Name', 'name');
        const mobile = pick(row, 'Mobile', 'mobile');
        if (!name || !mobile) {
          skipped += 1;
          errors.push({ row: line, detail: 'Name and Mobile are required' });
          continue;
        }
        const payload = {
          name,
          mobile,
          email: pick(row, 'Email', 'email') || null,
          job_title: pick(row, 'Job Title', 'job_title') || null,
          department: pick(row, 'Department', 'department') || null,
          salary: num(pick(row, 'Salary', 'salary'), 0),
          join_date: pick(row, 'Join Date', 'join_date') || null,
          status: pick(row, 'Status', 'status') || 'active',
          address: pick(row, 'Address', 'address') || null,
          emergency_contact: pick(row, 'Emergency Contact', 'emergency_contact') || null,
          shop_id: shopId,
        };

        const existing = await Employee.findOne({ where: { shop_id: shopId, mobile }, transaction });
        if (existing) {
          if (!updateExisting) { skipped += 1; continue; }
          await existing.update(payload, { transaction });
          updated += 1;
        } else {
          await Employee.create({ id: newId(), ...payload }, { transaction });
          created += 1;
        }
      } catch (err) {
        skipped += 1;
        errors.push({ row: line, detail: err.message || 'Import failed' });
      }
    }
  });

  return { created, updated, skipped, errors: errors.slice(0, 50), total_rows: rows.length };
}

export async function importQuotationsCsv(csvText, { userId = null, updateExisting = true } = {}) {
  const { rows } = parseCsv(csvText);
  if (!rows.length) {
    return { created: 0, updated: 0, skipped: 0, errors: [{ row: 0, detail: 'No data rows found' }] };
  }
  const shopId = await getDefaultShopId();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  await sequelize.transaction(async (transaction) => {
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const line = idx + 2;
      try {
        const customerName = pick(row, 'Customer Name', 'customer_name', 'Name');
        if (!customerName) {
          skipped += 1;
          errors.push({ row: line, detail: 'Customer Name is required' });
          continue;
        }
        const quoteNo = pick(row, 'Quote No', 'quote_no') || `Q-IMP-${Date.now()}-${idx}`;
        const grandTotal = num(pick(row, 'Grand Total', 'grand_total'), 0);
        const subtotal = num(pick(row, 'Subtotal', 'subtotal'), grandTotal);
        const gstPct = num(pick(row, 'GST %', 'gst_pct'), 3);
        const gstAmount = num(pick(row, 'GST Amount', 'gst_amount'), 0);
        const discount = num(pick(row, 'Discount', 'discount'), 0);

        const payload = {
          quote_no: quoteNo,
          customer_name: customerName,
          customer_mobile: pick(row, 'Mobile', 'customer_mobile') || null,
          customer_email: pick(row, 'Email', 'customer_email') || null,
          gold_rate: num(pick(row, 'Gold Rate', 'gold_rate'), 0),
          subtotal,
          discount,
          gst_pct: gstPct,
          gst_amount: gstAmount,
          grand_total: grandTotal || (subtotal - discount + gstAmount),
          valid_until: pick(row, 'Valid Until', 'valid_until') || null,
          status: pick(row, 'Status', 'status') || 'draft',
          notes: pick(row, 'Notes', 'notes') || null,
          items: [],
          created_by: userId || null,
          shop_id: shopId,
        };

        const existing = await Quotation.findOne({ where: { shop_id: shopId, quote_no: quoteNo }, transaction });
        if (existing) {
          if (!updateExisting) { skipped += 1; continue; }
          await existing.update(payload, { transaction });
          updated += 1;
        } else {
          await Quotation.create({ id: newId(), ...payload }, { transaction });
          created += 1;
        }
      } catch (err) {
        skipped += 1;
        errors.push({ row: line, detail: err.message || 'Import failed' });
      }
    }
  });

  return { created, updated, skipped, errors: errors.slice(0, 50), total_rows: rows.length };
}

export async function importExpensesCsv(csvText, { userId = null } = {}) {
  const { rows } = parseCsv(csvText);
  if (!rows.length) {
    return { created: 0, updated: 0, skipped: 0, errors: [{ row: 0, detail: 'No data rows found' }] };
  }
  const shopId = await getDefaultShopId();
  let created = 0;
  let skipped = 0;
  const errors = [];

  await sequelize.transaction(async (transaction) => {
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const line = idx + 2;
      try {
        const description = pick(row, 'Description', 'description');
        const amount = num(pick(row, 'Amount', 'amount'), NaN);
        const date = pick(row, 'Date', 'date') || new Date().toISOString().slice(0, 10);
        if (!description || !Number.isFinite(amount)) {
          skipped += 1;
          errors.push({ row: line, detail: 'Description and Amount are required' });
          continue;
        }
        await Expense.create({
          id: newId(),
          shop_id: shopId,
          description,
          amount,
          date,
          category_name: pick(row, 'Category', 'category_name', 'category') || null,
          payment_mode: pick(row, 'Payment Mode', 'payment_mode') || 'cash',
          reference: pick(row, 'Reference', 'reference') || null,
          notes: pick(row, 'Notes', 'notes') || null,
          created_by: userId || null,
        }, { transaction });
        created += 1;
      } catch (err) {
        skipped += 1;
        errors.push({ row: line, detail: err.message || 'Import failed' });
      }
    }
  });

  return { created, updated: 0, skipped, errors: errors.slice(0, 50), total_rows: rows.length };
}
