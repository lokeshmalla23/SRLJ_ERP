import { SchemePlan, Scheme } from '../models/index.js';
import { newId } from '../utils.js';

// GET /api/scheme-plans
export const listSchemePlans = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.active === 'true') where.active = true;

    const plans = await SchemePlan.findAll({ where, order: [['created_at', 'ASC']] });
    return res.json(plans.map((p) => p.toJSON()));
  } catch (err) {
    next(err);
  }
};

// POST /api/scheme-plans
export const createSchemePlan = async (req, res, next) => {
  try {
    const { name, plan_type, duration_months, bonus_months, default_monthly_amount, description } = req.body;

    if (!name || !duration_months) {
      return res.status(400).json({ detail: 'name and duration_months are required' });
    }

    const plan = await SchemePlan.create({
      id: newId(),
      name,
      plan_type: plan_type || 'amount',
      duration_months,
      bonus_months: bonus_months ?? 1,
      default_monthly_amount: default_monthly_amount || null,
      description: description || null,
      active: true,
    });
    return res.status(201).json(plan.toJSON());
  } catch (err) {
    next(err);
  }
};

// PATCH /api/scheme-plans/:id
export const updateSchemePlan = async (req, res, next) => {
  try {
    const plan = await SchemePlan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ detail: 'Scheme plan not found' });

    const { name, plan_type, duration_months, bonus_months, default_monthly_amount, description, active } = req.body;

    // Block reducing duration on a plan that has active enrollments which would lose months
    if (duration_months !== undefined && Number(duration_months) < Number(plan.duration_months)) {
      const activeCount = await Scheme.count({ where: { plan_name: plan.name, status: 'active' } });
      if (activeCount > 0) {
        return res.status(409).json({
          detail: `Cannot reduce duration — ${activeCount} active scheme(s) are enrolled in this plan.`,
          active_enrollments: activeCount,
        });
      }
    }

    await plan.update({
      ...(name !== undefined && { name }),
      ...(plan_type !== undefined && { plan_type }),
      ...(duration_months !== undefined && { duration_months }),
      ...(bonus_months !== undefined && { bonus_months }),
      ...(default_monthly_amount !== undefined && { default_monthly_amount }),
      ...(description !== undefined && { description }),
      ...(active !== undefined && { active }),
    });
    return res.json(plan.toJSON());
  } catch (err) {
    next(err);
  }
};

// DELETE /api/scheme-plans/:id
export const deleteSchemePlan = async (req, res, next) => {
  try {
    const plan = await SchemePlan.findByPk(req.params.id);
    if (!plan) return res.status(404).json({ detail: 'Scheme plan not found' });

    const activeCount = await Scheme.count({ where: { plan_name: plan.name, status: 'active' } });
    if (activeCount > 0) {
      return res.status(409).json({
        detail: `Cannot delete — ${activeCount} active scheme(s) are enrolled in this plan. Archive the plan instead by setting active=false.`,
        active_enrollments: activeCount,
      });
    }

    await plan.destroy();
    return res.json({ message: 'Scheme plan deleted' });
  } catch (err) {
    next(err);
  }
};
