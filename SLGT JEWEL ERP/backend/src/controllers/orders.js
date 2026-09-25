import { Op } from 'sequelize';
import sequelize from '../db.js';
import { Order, Customer, Vendor } from '../models/index.js';
import { likeOp } from '../db.js';
import { newId, nowIso } from '../utils.js';
import branchConfig from '../config/branchConfig.js';
import { broadcast } from '../services/wsServer.js';
import { getActiveBillingDate } from '../services/dailyClosingService.js';
import { stampOnTransactionDateIso } from '../utils/invoiceRead.js';

// Mobile is a contact/search field, not a unique key — never resolve a
// customer to update by mobile match alone, since that could silently edit
// a different person's record who happens to share the number. Only touch
// a customer explicitly linked via customerId.
async function applyCustomerOccasions({ customerId, dob, anniversary }, transaction) {
  if (!dob && !anniversary) return;
  if (!customerId) return;
  const customer = await Customer.findByPk(customerId, { transaction });
  if (!customer) return;
  const patch = {};
  if (dob) patch.dob = dob;
  if (anniversary) patch.anniversary = anniversary;
  if (Object.keys(patch).length) await customer.update(patch, { transaction });
}

/** Resolve karigar name from vendor id when linking. */
async function resolveKarigarFromVendor(karigar_vendor_id, transaction) {
  if (!karigar_vendor_id) return { karigar_vendor_id: null, karigar_name: null };
  const vendor = await Vendor.findByPk(karigar_vendor_id, { transaction });
  if (!vendor) {
    const err = new Error('Karigar vendor not found');
    err.status = 400;
    throw err;
  }
  return {
    karigar_vendor_id: vendor.id,
    karigar_name: vendor.name,
  };
}

// ─── Status flow ─────────────────────────────────────────────────────────────
const VALID_STATUSES = [
  'received',
  'karigar_assigned',
  'in_progress',
  'quality_check',
  'ready',
  'delivered',
  'cancelled',
];

// ─── Generate order number ────────────────────────────────────────────────────
const generateOrderNo = async (type, t) => {
  const prefix = type === 'repair' ? 'REP' : 'ORD';
  const year = new Date().getFullYear();
  const count = await Order.count({ where: { type }, transaction: t });
  const seq = String(count + 1).padStart(3, '0');
  return `${prefix}-${year}-${seq}`;
};

// GET /api/orders
export const listOrders = async (req, res, next) => {
  try {
    const {
      type,
      status,
      customer_id,
      karigar_name,
      karigar_vendor_id,
      from,
      to,
      priority,
      search,
      limit = 20,
      offset = 0,
    } = req.query;

    const where = { deleted_at: null };

    if (type) where.type = type;
    if (status) where.status = status;
    if (customer_id) where.customer_id = customer_id;
    if (priority) where.priority = priority;
    if (karigar_vendor_id) where.karigar_vendor_id = karigar_vendor_id;

    if (karigar_name) {
      where.karigar_name = { [likeOp]: `%${karigar_name}%` };
    }

    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        where.created_at[Op.lte] = end;
      }
    }

    if (search) {
      where[Op.or] = [
        { order_no: { [likeOp]: `%${search}%` } },
        { customer_name: { [likeOp]: `%${search}%` } },
      ];
    }

    const { count: total, rows } = await Order.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return res.json({ total, orders: rows.map((o) => o.toJSON()) });
  } catch (err) {
    next(err);
  }
};

// GET /api/orders/summary
export const getOrderSummary = async (req, res, next) => {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const [
      total,
      received,
      in_progress,
      ready,
      delivered,
      today_deliveries,
      overdue,
      urgent,
    ] = await Promise.all([
      Order.count({ where: { deleted_at: null } }),
      Order.count({ where: { status: 'received', deleted_at: null } }),
      Order.count({ where: { status: 'in_progress', deleted_at: null } }),
      Order.count({ where: { status: 'ready', deleted_at: null } }),
      Order.count({ where: { status: 'delivered', deleted_at: null } }),
      Order.count({
        where: {
          delivery_date: todayStr,
          status: { [Op.ne]: 'delivered' },
          deleted_at: null,
        },
      }),
      Order.count({
        where: {
          delivery_date: { [Op.lt]: todayStr },
          status: { [Op.notIn]: ['delivered', 'cancelled'] },
          deleted_at: null,
        },
      }),
      Order.count({
        where: {
          priority: 'urgent',
          status: { [Op.notIn]: ['delivered', 'cancelled'] },
          deleted_at: null,
        },
      }),
    ]);

    return res.json({
      total,
      by_status: { received, in_progress, ready, delivered },
      today_deliveries,
      overdue,
      urgent,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/orders/today-deliveries
export const getTodayDeliveries = async (req, res, next) => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);

    const orders = await Order.findAll({
      where: {
        delivery_date: todayStr,
        status: { [Op.ne]: 'delivered' },
        deleted_at: null,
      },
      order: [['priority', 'DESC'], ['customer_name', 'ASC']],
    });

    return res.json(orders.map((o) => o.toJSON()));
  } catch (err) {
    next(err);
  }
};

// GET /api/orders/:id
export const getOrder = async (req, res, next) => {
  try {
    const order = await Order.findByPk(req.params.id);
    if (!order || order.deleted_at) return res.status(404).json({ detail: 'Order not found' });
    return res.json(order.toJSON());
  } catch (err) {
    next(err);
  }
};

// POST /api/orders
export const createOrder = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const body = req.body || {};
    const nestedCustomer = body.customer && typeof body.customer === 'object' ? body.customer : null;
    const type = body.type;
    const customer_id = body.customer_id ?? nestedCustomer?.id ?? null;
    const customer_name = body.customer_name ?? nestedCustomer?.name ?? null;
    const customer_mobile = body.customer_mobile ?? nestedCustomer?.mobile ?? null;
    const customer_dob = body.customer_dob ?? nestedCustomer?.dob ?? null;
    const customer_anniversary = body.customer_anniversary ?? nestedCustomer?.anniversary ?? null;

    // Repair jobs may send item_description + repair_work instead of description
    const description = body.description
      || [body.item_description, body.repair_work].filter(Boolean).join(' — ')
      || null;

    const metal_type = body.metal_type;
    const purity = body.purity;
    const estimated_weight = body.estimated_weight ?? body.est_weight;
    const stone_details = body.stone_details;
    const estimated_price = body.estimated_price ?? body.est_price ?? 0;
    const advance_paid = body.advance_paid ?? 0;
    const delivery_date = body.delivery_date;
    const priority = body.priority || 'normal';
    const notes = body.notes;
    // Karigar is assigned after noting the order — accept if provided, otherwise leave null
    const karigar_vendor_id = body.karigar_vendor_id || null;
    const karigar_name = body.karigar_name || null;

    if (!customer_name || !String(customer_name).trim()) {
      await t.rollback();
      return res.status(400).json({ detail: 'customer_name is required' });
    }
    if (!description || !String(description).trim()) {
      await t.rollback();
      return res.status(400).json({ detail: 'description is required' });
    }
    if (!type || !['custom', 'repair'].includes(type)) {
      await t.rollback();
      return res.status(400).json({ detail: 'type must be "custom" or "repair"' });
    }

    let resolvedMobile = customer_mobile;
    if (customer_id && !resolvedMobile) {
      const customer = await Customer.findByPk(customer_id, { transaction: t });
      if (customer) resolvedMobile = customer.mobile;
    }

    let karigarFields = { karigar_vendor_id: null, karigar_name: karigar_name || null };
    let initialStatus = 'received';
    if (karigar_vendor_id) {
      try {
        karigarFields = await resolveKarigarFromVendor(karigar_vendor_id, t);
        if (karigar_name) karigarFields.karigar_name = karigar_name;
        initialStatus = 'karigar_assigned';
      } catch (e) {
        await t.rollback();
        return res.status(e.status || 400).json({ detail: e.message });
      }
    }

    const order_no = await generateOrderNo(type, t);
    const priceNum = parseFloat(estimated_price) || 0;
    const advanceNum = parseFloat(advance_paid) || 0;
    const balance_due = priceNum - advanceNum;
    const shopId = req.user?.shop_id || branchConfig.shop_id;

    // Same rule as every other transaction in the app: anchor to the shop's
    // active transaction date, real clock only supplies the time-of-day.
    const advancePayments = [];
    if (advanceNum > 0) {
      const { date: businessDate } = await getActiveBillingDate({ shopId, transaction: t });
      advancePayments.push({
        amount: advanceNum,
        mode: body.payment_mode || 'cash',
        paid_at: stampOnTransactionDateIso(businessDate),
        business_date: businessDate,
        reference: 'Advance at order creation',
      });
    }

    const order = await Order.create({
      id: newId(),
      shop_id: shopId,
      order_no,
      type,
      customer_id: customer_id || null,
      customer_name: String(customer_name).trim(),
      customer_mobile: resolvedMobile || null,
      description: String(description).trim(),
      metal_type: metal_type || null,
      purity: purity || null,
      estimated_weight: estimated_weight != null && estimated_weight !== '' ? parseFloat(estimated_weight) : null,
      stone_details: stone_details || null,
      estimated_price: priceNum,
      advance_paid: advanceNum,
      advance_payments: advancePayments,
      balance_due,
      karigar_name: karigarFields.karigar_name,
      karigar_vendor_id: karigarFields.karigar_vendor_id,
      delivery_date: delivery_date || null,
      status: initialStatus,
      priority,
      notes: notes || null,
      customer_dob: customer_dob || null,
      customer_anniversary: customer_anniversary || null,
      created_by: req.user?.id || null,
    }, { transaction: t });

    await applyCustomerOccasions({
      customerId: order.customer_id,
      dob: customer_dob,
      anniversary: customer_anniversary,
    }, t);

    await t.commit();
    broadcast({ type: 'order:changed', op: 'create', id: order.id });
    return res.status(201).json(order.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// PUT /api/orders/:id
export const updateOrder = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const order = await Order.findByPk(req.params.id, { transaction: t });
    if (!order || order.deleted_at) {
      await t.rollback();
      return res.status(404).json({ detail: 'Order not found' });
    }

    const {
      customer_id,
      customer_name,
      customer_mobile,
      customer_dob,
      customer_anniversary,
      customer,
      description,
      metal_type,
      purity,
      estimated_weight,
      stone_details,
      estimated_price,
      est_price,
      est_weight,
      advance_paid,
      karigar_name,
      karigar_vendor_id,
      delivery_date,
      priority,
      notes,
    } = req.body;

    const updates = {};
    const priceIn = estimated_price !== undefined ? estimated_price : est_price;
    const weightIn = estimated_weight !== undefined ? estimated_weight : est_weight;

    if (customer_id !== undefined) updates.customer_id = customer_id;
    if (customer_name !== undefined) {
      if (!customer_name.trim()) {
        await t.rollback();
        return res.status(400).json({ detail: 'customer_name cannot be blank' });
      }
      updates.customer_name = customer_name.trim();
    }
    if (customer_mobile !== undefined) updates.customer_mobile = customer_mobile;
    const nestedCustomer = customer && typeof customer === 'object' ? customer : null;
    const nextDob = customer_dob ?? nestedCustomer?.dob;
    const nextAnniversary = customer_anniversary ?? nestedCustomer?.anniversary;
    if (nextDob !== undefined) updates.customer_dob = nextDob || null;
    if (nextAnniversary !== undefined) updates.customer_anniversary = nextAnniversary || null;
    if (description !== undefined) {
      if (!description.trim()) {
        await t.rollback();
        return res.status(400).json({ detail: 'description cannot be blank' });
      }
      updates.description = description.trim();
    }
    if (metal_type !== undefined) updates.metal_type = metal_type;
    if (purity !== undefined) updates.purity = purity;
    if (weightIn !== undefined) updates.estimated_weight = weightIn != null && weightIn !== '' ? parseFloat(weightIn) : null;
    if (stone_details !== undefined) updates.stone_details = stone_details;
    if (delivery_date !== undefined) updates.delivery_date = delivery_date;
    if (priority !== undefined) updates.priority = priority;
    if (notes !== undefined) updates.notes = notes;

    if (karigar_vendor_id !== undefined) {
      if (karigar_vendor_id) {
        try {
          const resolved = await resolveKarigarFromVendor(karigar_vendor_id, t);
          updates.karigar_vendor_id = resolved.karigar_vendor_id;
          updates.karigar_name = karigar_name !== undefined ? (karigar_name || resolved.karigar_name) : resolved.karigar_name;
        } catch (e) {
          await t.rollback();
          return res.status(e.status || 400).json({ detail: e.message });
        }
      } else {
        updates.karigar_vendor_id = null;
        if (karigar_name !== undefined) updates.karigar_name = karigar_name || null;
      }
    } else if (karigar_name !== undefined) {
      updates.karigar_name = karigar_name;
    }

    const newEstimatedPrice = priceIn !== undefined ? parseFloat(priceIn) || 0 : order.estimated_price;
    const newAdvancePaid = advance_paid !== undefined ? parseFloat(advance_paid) || 0 : order.advance_paid;

    if (priceIn !== undefined) updates.estimated_price = newEstimatedPrice;
    if (advance_paid !== undefined) {
      updates.advance_paid = newAdvancePaid;
      const delta = newAdvancePaid - (parseFloat(order.advance_paid) || 0);
      if (delta > 0.009) {
        // Same rule as every other transaction in the app: anchor to the shop's
        // active transaction date, real clock only supplies the time-of-day.
        const { date: businessDate } = await getActiveBillingDate({
          shopId: order.shop_id,
          transaction: t,
        });
        updates.advance_payments = [
          ...(Array.isArray(order.advance_payments) ? order.advance_payments : []),
          {
            amount: delta,
            mode: req.body.payment_mode || 'cash',
            paid_at: stampOnTransactionDateIso(businessDate),
            business_date: businessDate,
            reference: req.body.payment_reference || 'Additional advance',
          },
        ];
      }
    }

    if (priceIn !== undefined || advance_paid !== undefined) {
      updates.balance_due = newEstimatedPrice - newAdvancePaid;
    }

    await order.update(updates, { transaction: t });
    await applyCustomerOccasions({
      customerId: updates.customer_id !== undefined ? updates.customer_id : order.customer_id,
      dob: nextDob,
      anniversary: nextAnniversary,
    }, t);

    await t.commit();
    broadcast({ type: 'order:changed', op: 'update', id: order.id });
    return res.json(order.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// PUT /api/orders/:id/status
export const updateOrderStatus = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const order = await Order.findByPk(req.params.id, { transaction: t });
    if (!order || order.deleted_at) {
      await t.rollback();
      return res.status(404).json({ detail: 'Order not found' });
    }

    const { status, notes } = req.body;

    if (!status) {
      await t.rollback();
      return res.status(400).json({ detail: 'status is required' });
    }
    if (!VALID_STATUSES.includes(status)) {
      await t.rollback();
      return res.status(400).json({
        detail: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    const updates = { status };
    if (notes !== undefined) updates.notes = notes;
    if (status === 'delivered') updates.balance_due = 0;

    await order.update(updates, { transaction: t });

    await t.commit();
    return res.json(order.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// PATCH /api/orders/:id/karigar
export const updateKarigar = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const order = await Order.findByPk(req.params.id, { transaction: t });
    if (!order || order.deleted_at) {
      await t.rollback();
      return res.status(404).json({ detail: 'Order not found' });
    }

    const { karigar_vendor_id, karigar_name } = req.body;
    const updates = {};

    if (karigar_vendor_id !== undefined) {
      if (karigar_vendor_id) {
        try {
          const resolved = await resolveKarigarFromVendor(karigar_vendor_id, t);
          updates.karigar_vendor_id = resolved.karigar_vendor_id;
          updates.karigar_name = karigar_name || resolved.karigar_name;
        } catch (e) {
          await t.rollback();
          return res.status(e.status || 400).json({ detail: e.message });
        }
      } else {
        updates.karigar_vendor_id = null;
        updates.karigar_name = karigar_name || null;
      }
    } else if (karigar_name !== undefined) {
      updates.karigar_name = karigar_name || null;
    }

    // First assign moves Received → Karigar Assigned
    if (
      (updates.karigar_vendor_id || updates.karigar_name) &&
      order.status === 'received'
    ) {
      updates.status = 'karigar_assigned';
    }

    await order.update(updates, { transaction: t });

    await t.commit();
    broadcast({ type: 'order:changed', op: 'update', id: order.id });
    return res.json(order.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// DELETE /api/orders/:id
export const deleteOrder = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const order = await Order.findByPk(req.params.id, { transaction: t });
    if (!order || order.deleted_at) {
      await t.rollback();
      return res.status(404).json({ detail: 'Order not found' });
    }

    if (order.status !== 'received') {
      await t.rollback();
      return res.status(400).json({
        detail: 'Only orders with status "received" can be deleted',
      });
    }

    await order.update({ status: 'cancelled', deleted_at: nowIso() }, { transaction: t });

    await t.commit();
    return res.json({ detail: 'Order deleted successfully' });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};
