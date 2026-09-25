import { Op } from 'sequelize';
import { Campaign, CampaignMessage, Customer, Invoice, Scheme } from '../models/index.js';
import { newId, nowIso } from '../utils.js';
import { occasionMatches } from '../utils/occasionDate.js';

function whatsappPhone(mobile) {
  let digits = String(mobile || '').replace(/\D/g, '');
  if (!digits) return null;
  while (digits.length > 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length !== 12 || !digits.startsWith('91')) return null;
  const local = digits.slice(2);
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return digits;
}

// ─── Built-in templates ──────────────────────────────────────────────────────
const BUILT_IN_TEMPLATES = [
  {
    type: 'festival',
    name: 'Festival Greeting',
    template: 'Dear {{name}}, Wishing you and your family a joyous celebration! Visit Sri Srinivasa Jewellers for exclusive festive offers. Our finest collection awaits you. 🌟',
  },
  {
    type: 'birthday',
    name: 'Birthday Wishes',
    template: 'Dear {{name}}, Wishing you a very Happy Birthday! 🎂 As a special gift, enjoy exclusive offers at Sri Srinivasa Jewellers this month. Come celebrate with us!',
  },
  {
    type: 'anniversary',
    name: 'Anniversary Wishes',
    template: 'Dear {{name}}, Happy Anniversary! 💍 Celebrate this special day with a beautiful piece from our exclusive collection at Sri Srinivasa Jewellers.',
  },
  {
    type: 'scheme_reminder',
    name: 'Scheme Payment Reminder',
    template: 'Dear {{name}}, this is a friendly reminder that your Gold Saving Scheme installment is due. Please visit Sri Srinivasa Jewellers or call us to make your payment. Thank you!',
  },
  {
    type: 'scheme_maturity',
    name: 'Scheme Maturity Alert',
    template: 'Dear {{name}}, Congratulations! 🎉 Your Gold Saving Scheme has matured. Please visit Sri Srinivasa Jewellers to redeem your gold. We look forward to serving you!',
  },
  {
    type: 'new_collection',
    name: 'New Collection Launch',
    template: 'Dear {{name}}, We are excited to announce our latest collection at Sri Srinivasa Jewellers! Visit us to explore exquisite new designs. Special preview for valued customers like you. ✨',
  },
  {
    type: 'custom',
    name: 'Custom Message',
    template: 'Dear {{name}}, ',
  },
];

// ─── Segment resolver ────────────────────────────────────────────────────────
async function resolveSegment(segment, segmentConfig = {}) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-based

  switch (segment) {
    case 'all':
      return Customer.findAll({ order: [['name', 'ASC']] });

    case 'vip':
      return Customer.findAll({ where: { tag: 'vip' }, order: [['name', 'ASC']] });

    case 'birthday_month': {
      const customers = await Customer.findAll({ order: [['name', 'ASC']] });
      return customers.filter((c) => occasionMatches(c.dob, { month: currentMonth }));
    }

    case 'anniversary_month': {
      const customers = await Customer.findAll({ order: [['name', 'ASC']] });
      return customers.filter((c) => occasionMatches(c.anniversary, { month: currentMonth }));
    }

    case 'scheme_overdue': {
      // Customers with active schemes where paid installments < months elapsed
      const activeSchemes = await Scheme.findAll({ where: { status: 'active' } });
      const overdueCustomerIds = new Set();

      for (const scheme of activeSchemes) {
        const start = new Date(scheme.start_date);
        const monthsElapsed = Math.floor(
          (now - start) / (1000 * 60 * 60 * 24 * 30.44),
        );
        const paidInstallments = (scheme.payments || []).length;
        if (paidInstallments < monthsElapsed && scheme.customer_id) {
          overdueCustomerIds.add(scheme.customer_id);
        }
      }

      if (overdueCustomerIds.size === 0) return [];
      return Customer.findAll({
        where: { id: { [Op.in]: [...overdueCustomerIds] } },
        order: [['name', 'ASC']],
      });
    }

    case 'scheme_matured': {
      const allSchemes = await Scheme.findAll();
      const maturedCustomerIds = new Set();

      for (const scheme of allSchemes) {
        const paidInstallments = (scheme.payments || []).length;
        if (paidInstallments >= scheme.duration_months && scheme.customer_id) {
          maturedCustomerIds.add(scheme.customer_id);
        }
      }

      if (maturedCustomerIds.size === 0) return [];
      return Customer.findAll({
        where: { id: { [Op.in]: [...maturedCustomerIds] } },
        order: [['name', 'ASC']],
      });
    }

    case 'inactive': {
      // Customers with no invoices in last 180 days
      const cutoff = new Date(now - 180 * 24 * 60 * 60 * 1000);
      const recentInvoices = await Invoice.findAll({
        where: { created_at: { [Op.gte]: cutoff } },
        attributes: ['customer_id'],
      });
      const activeCustomerIds = new Set(
        recentInvoices.map((inv) => inv.customer_id).filter(Boolean),
      );

      return Customer.findAll({
        where: activeCustomerIds.size > 0
          ? { id: { [Op.notIn]: [...activeCustomerIds] } }
          : {},
        order: [['name', 'ASC']],
      });
    }

    case 'high_value': {
      const minPurchase = Number(segmentConfig?.min_purchase) || 100000;
      return Customer.findAll({
        where: { total_purchases: { [Op.gte]: minPurchase } },
        order: [['total_purchases', 'DESC']],
      });
    }

    default:
      return Customer.findAll({ order: [['name', 'ASC']] });
  }
}

// ─── Message renderer ────────────────────────────────────────────────────────
function renderMessage(template, customer) {
  const shopName = 'Sri Srinivasa Jewellers';
  const today = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return template
    .replace(/\{\{name\}\}/g, customer.name || '')
    .replace(/\{\{mobile\}\}/g, customer.mobile || '')
    .replace(/\{\{shop_name\}\}/g, shopName)
    .replace(/\{\{date\}\}/g, today);
}

// GET /api/promotions/templates
export const listTemplates = (_req, res) => {
  return res.json(BUILT_IN_TEMPLATES);
};

// GET /api/promotions/segments/preview
export const previewSegment = async (req, res, next) => {
  try {
    const { segment, segment_config } = req.query;
    let config = {};
    if (segment_config) {
      try { config = JSON.parse(segment_config); } catch { /* ignore */ }
    }

    const customers = await resolveSegment(segment || 'all', config);
    return res.json({
      count: customers.length,
      preview: customers.slice(0, 5).map((c) => ({ id: c.id, name: c.name, mobile: c.mobile })),
      customers: customers.map((c) => c.toJSON()),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/promotions/campaigns
export const listCampaigns = async (req, res, next) => {
  try {
    const campaigns = await Campaign.findAll({ order: [['created_at', 'DESC']] });
    return res.json(campaigns.map((c) => c.toJSON()));
  } catch (err) {
    next(err);
  }
};

// POST /api/promotions/campaigns
export const createCampaign = async (req, res, next) => {
  try {
    const { name, type, message_template, segment, segment_config, scheduled_at } = req.body;

    if (!name || !type || !message_template || !segment) {
      return res.status(400).json({ detail: 'name, type, message_template, and segment are required' });
    }

    const campaign = await Campaign.create({
      id: newId(),
      name,
      type,
      message_template,
      segment,
      segment_config: segment_config || {},
      status: 'draft',
      scheduled_at: scheduled_at || null,
      sent_at: null,
      total_recipients: 0,
      sent_count: 0,
      created_by: req.user?.id || null,
    });

    return res.status(201).json(campaign.toJSON());
  } catch (err) {
    next(err);
  }
};

// GET /api/promotions/campaigns/:id
export const getCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findByPk(req.params.id);
    if (!campaign) return res.status(404).json({ detail: 'Campaign not found' });

    const messages = await CampaignMessage.findAll({
      where: { campaign_id: req.params.id },
      order: [['created_at', 'ASC']],
    });

    return res.json({ campaign: campaign.toJSON(), messages: messages.map((m) => m.toJSON()) });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/promotions/campaigns/:id
export const deleteCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findByPk(req.params.id);
    if (!campaign) return res.status(404).json({ detail: 'Campaign not found' });
    if (campaign.status !== 'draft') {
      return res.status(400).json({ detail: 'Only draft campaigns can be deleted' });
    }

    await campaign.destroy();
    return res.json({ message: 'Campaign deleted' });
  } catch (err) {
    next(err);
  }
};

// POST /api/promotions/campaigns/:id/send
export const sendCampaign = async (req, res, next) => {
  try {
    const campaign = await Campaign.findByPk(req.params.id);
    if (!campaign) return res.status(404).json({ detail: 'Campaign not found' });

    // Resolve segment
    const customers = await resolveSegment(campaign.segment, campaign.segment_config || {});

    // Create messages
    const messageRecords = customers.map((customer) => {
      const message = renderMessage(campaign.message_template, customer.toJSON ? customer.toJSON() : customer);
      const phone = whatsappPhone(customer.mobile);
      const whatsappUrl = phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
        : null;

      return {
        id: newId(),
        campaign_id: campaign.id,
        customer_id: customer.id,
        customer_name: customer.name,
        mobile: customer.mobile,
        message,
        whatsapp_url: whatsappUrl,
        status: 'sent',
      };
    });

    if (messageRecords.length > 0) {
      await CampaignMessage.bulkCreate(messageRecords);
    }

    await campaign.update({
      status: 'sent',
      sent_at: nowIso(),
      total_recipients: customers.length,
      sent_count: customers.length,
    });

    return res.json({
      campaign: campaign.toJSON(),
      sent_count: customers.length,
    });
  } catch (err) {
    next(err);
  }
};
