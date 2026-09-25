import { Op, fn, col } from 'sequelize';
import { Vendor } from '../models/index.js';
import { likeOp } from '../db.js';
import { newId } from '../utils.js';

const VENDOR_TYPES = ['gold_supplier', 'stone_supplier', 'manufacturer', 'karigar', 'other'];

// GET /api/vendors/summary
export const getVendorSummary = async (req, res, next) => {
  try {
    const [total, active, byTypeRows, outstandingRow] = await Promise.all([
      Vendor.count(),
      Vendor.count({ where: { status: 'active' } }),
      Vendor.findAll({
        attributes: ['type', [fn('COUNT', col('id')), 'count']],
        group: ['type'],
        raw: true,
      }),
      Vendor.findAll({
        attributes: [[fn('SUM', col('outstanding_balance')), 'total_outstanding']],
        raw: true,
      }),
    ]);

    const by_type = Object.fromEntries(VENDOR_TYPES.map((t) => [t, 0]));
    for (const row of byTypeRows) {
      if (row.type && by_type[row.type] !== undefined) {
        by_type[row.type] = parseInt(row.count, 10);
      }
    }

    const total_outstanding = parseFloat(outstandingRow[0]?.total_outstanding ?? 0) || 0;

    return res.json({ total, active, by_type, total_outstanding });
  } catch (err) {
    next(err);
  }
};

// GET /api/vendors
export const listVendors = async (req, res, next) => {
  try {
    const { search, type, status } = req.query;
    const where = {};

    if (search) {
      where[Op.or] = [
        { name: { [likeOp]: `%${search}%` } },
        { mobile: { [likeOp]: `%${search}%` } },
        { gst_number: { [likeOp]: `%${search}%` } },
      ];
    }

    if (type && VENDOR_TYPES.includes(type)) {
      where.type = type;
    }

    if (status === 'active' || status === 'inactive') {
      where.status = status;
    }

    const vendors = await Vendor.findAll({
      where,
      attributes: [
        'id',
        'name',
        'type',
        'contact_person',
        'mobile',
        'email',
        'address',
        'gst_number',
        'pan_number',
        'credit_limit',
        'credit_days',
        'outstanding_balance',
        'total_purchases',
        'status',
        'notes',
      ],
      order: [['name', 'ASC']],
    });

    return res.json(vendors.map((v) => v.toJSON()));
  } catch (err) {
    next(err);
  }
};

// POST /api/vendors
export const createVendor = async (req, res, next) => {
  try {
    const {
      name,
      type,
      contact_person,
      mobile,
      email,
      address,
      gst_number,
      pan_number,
      bank_details,
      credit_limit,
      credit_days,
      outstanding_balance,
      total_purchases,
      notes,
      status,
    } = req.body;

    if (!name || !mobile) {
      return res.status(400).json({ detail: 'name and mobile are required' });
    }

    const vendor = await Vendor.create({
      id: newId(),
      name,
      type: type && VENDOR_TYPES.includes(type) ? type : 'other',
      contact_person: contact_person || null,
      mobile,
      email: email || null,
      address: address || null,
      gst_number: gst_number || null,
      pan_number: pan_number || null,
      bank_details: bank_details || null,
      credit_limit: credit_limit ?? null,
      credit_days: credit_days ?? null,
      outstanding_balance: outstanding_balance ?? 0,
      total_purchases: total_purchases ?? 0,
      notes: notes || null,
      status: status === 'inactive' ? 'inactive' : 'active',
    });

    return res.status(201).json(vendor.toJSON());
  } catch (err) {
    next(err);
  }
};

// GET /api/vendors/:id
export const getVendor = async (req, res, next) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ detail: 'Vendor not found' });

    return res.json(vendor.toJSON());
  } catch (err) {
    next(err);
  }
};

// PUT /api/vendors/:id
export const updateVendor = async (req, res, next) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ detail: 'Vendor not found' });

    const {
      name,
      type,
      contact_person,
      mobile,
      email,
      address,
      gst_number,
      pan_number,
      bank_details,
      credit_limit,
      credit_days,
      outstanding_balance,
      total_purchases,
      notes,
      status,
    } = req.body;

    await vendor.update({
      name,
      type: type && VENDOR_TYPES.includes(type) ? type : vendor.type,
      contact_person,
      mobile,
      email,
      address,
      gst_number,
      pan_number,
      bank_details,
      credit_limit,
      credit_days,
      outstanding_balance,
      total_purchases,
      notes,
      status,
    });

    return res.json(vendor.toJSON());
  } catch (err) {
    next(err);
  }
};

// DELETE /api/vendors/:id
export const deleteVendor = async (req, res, next) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id);
    if (!vendor) return res.status(404).json({ detail: 'Vendor not found' });

    await vendor.update({ status: 'inactive' });
    return res.json({ message: 'Vendor deactivated' });
  } catch (err) {
    next(err);
  }
};
