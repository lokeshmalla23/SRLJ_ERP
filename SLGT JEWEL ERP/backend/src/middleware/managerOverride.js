/**
 * Manager PIN override for discounts / price overrides above policy threshold.
 */
export function requireManagerOverride(req, res, next) {
  const pin = req.headers['x-manager-pin'] || req.body?.manager_pin;
  // Soft gate: if client signals override_required, PIN must be present.
  // Actual PIN check happens against settings in verifyManagerPin middleware when used.
  if (req.body?.requires_manager_override && !pin) {
    return res.status(403).json({
      detail: 'Manager override PIN required',
      code: 'MANAGER_OVERRIDE_REQUIRED',
    });
  }
  next();
}

export async function verifyManagerPin(req, res, next) {
  try {
    const pin = String(req.headers['x-manager-pin'] || req.body?.manager_pin || '').trim();
    if (!pin) {
      return res.status(400).json({ detail: 'manager_pin required', code: 'MANAGER_OVERRIDE_REQUIRED' });
    }
    const { Setting } = await import('../models/index.js');
    const setting = await Setting.findOne({ where: { key: 'invoice' } });
    let value = setting?.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { value = {}; }
    }
    const expected = value?.manager_override_pin != null ? String(value.manager_override_pin) : '0000';
    if (pin !== expected) {
      return res.status(403).json({ detail: 'Invalid manager PIN', code: 'MANAGER_OVERRIDE_DENIED' });
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
