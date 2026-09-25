import { Op } from 'sequelize';
import { BarcodeTemplate, Product } from '../models/index.js';

// GET /api/barcodes/templates
export const listTemplates = async (_req, res) => {
  try {
    const rows = await BarcodeTemplate.findAll({ order: [['is_default', 'DESC'], ['name', 'ASC']] });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
};

// POST /api/barcodes/templates
export const createTemplate = async (req, res) => {
  try {
    const body = req.body;
    if (body.is_default) {
      await BarcodeTemplate.update({ is_default: false }, { where: {} });
    }
    const tpl = await BarcodeTemplate.create({ ...body });
    res.status(201).json(tpl);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
};

// PUT /api/barcodes/templates/:id
export const updateTemplate = async (req, res) => {
  try {
    const tpl = await BarcodeTemplate.findByPk(req.params.id);
    if (!tpl) return res.status(404).json({ detail: 'Not found' });
    if (req.body.is_default) {
      await BarcodeTemplate.update({ is_default: false }, { where: {} });
    }
    await tpl.update(req.body);
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
};

// DELETE /api/barcodes/templates/:id
export const deleteTemplate = async (req, res) => {
  try {
    const tpl = await BarcodeTemplate.findByPk(req.params.id);
    if (!tpl) return res.status(404).json({ detail: 'Not found' });
    await tpl.destroy();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
};

// POST /api/barcodes/templates/:id/set-default
export const setDefaultTemplate = async (req, res) => {
  try {
    await BarcodeTemplate.update({ is_default: false }, { where: {} });
    const tpl = await BarcodeTemplate.findByPk(req.params.id);
    if (!tpl) return res.status(404).json({ detail: 'Not found' });
    await tpl.update({ is_default: true });
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
};

// POST /api/barcodes/generate-missing
export const generateMissingBarcodes = async (req, res) => {
  try {
    const products = await Product.findAll({
      where: { barcode: { [Op.or]: [null, ''] } },
    });
    let count = 0;
    for (const p of products) {
      const barcode = p.code || `AUR${String(p.id).replace(/-/g, '').slice(0, 10).toUpperCase()}`;
      await p.update({ barcode });
      count++;
    }
    res.json({ generated: count, message: `Generated barcodes for ${count} products` });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
};

// GET /api/barcodes/stats
export const getBarcodeStats = async (_req, res) => {
  try {
    const total = await Product.count();
    const withBarcode = await Product.count({ where: { barcode: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } } });
    res.json({ total, with_barcode: withBarcode, missing: total - withBarcode });
  } catch (err) {
    res.status(500).json({ detail: err.message });
  }
};
