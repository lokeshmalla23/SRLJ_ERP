import { MODULES, ACTIONS } from '../constants.js';

/**
 * Normalize all users.permissions to canonical object form:
 * { [module]: { [action]: boolean } }
 */
export async function up({ context: qi }) {
  const sequelize = qi.sequelize;
  const [users] = await sequelize.query(`SELECT id, permissions FROM users`);

  for (const user of users) {
    const raw = user.permissions;
    const normalized = normalize(raw);
    await sequelize.query(
      `UPDATE users SET permissions = :perms::jsonb, updated_at = NOW() WHERE id = :id`,
      {
        replacements: {
          id: user.id,
          perms: JSON.stringify(normalized),
        },
      }
    );
  }
}

export async function down() {
  // Irreversible without original shapes — no-op (canonical remains valid for both readers)
}

function normalize(raw) {
  const result = {};
  for (const mod of MODULES) {
    result[mod] = {};
    for (const action of ACTIONS) result[mod][action] = false;
  }
  if (!raw || typeof raw !== 'object') return result;

  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  for (const [mod, val] of Object.entries(obj)) {
    if (!result[mod]) {
      result[mod] = {};
      for (const action of ACTIONS) result[mod][action] = false;
    }
    if (Array.isArray(val)) {
      for (const action of val) {
        if (ACTIONS.includes(action)) result[mod][action] = true;
      }
    } else if (val && typeof val === 'object') {
      for (const action of ACTIONS) {
        result[mod][action] = Boolean(val[action]);
      }
    }
  }
  return result;
}
