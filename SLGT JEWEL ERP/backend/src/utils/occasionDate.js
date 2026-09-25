/** Calendar month/day from DATEONLY without timezone shift. */

export function dateOnlyParts(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const iso = raw.toISOString();
    // Sequelize DATEONLY is typically UTC midnight of the intended calendar day.
    if (iso.endsWith('T00:00:00.000Z')) {
      return { year: raw.getUTCFullYear(), month: raw.getUTCMonth() + 1, day: raw.getUTCDate() };
    }
    return { year: raw.getFullYear(), month: raw.getMonth() + 1, day: raw.getDate() };
  }
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

export function formatDateOnly(raw) {
  const parts = dateOnlyParts(raw);
  if (!parts) return null;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function realTodayParts(now = new Date()) {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

export function isTodayOccasion(raw, now = new Date()) {
  const parts = dateOnlyParts(raw);
  if (!parts) return false;
  const today = realTodayParts(now);
  return parts.month === today.month && parts.day === today.day;
}

export function normalizeOccasionQuery(query = {}) {
  const today = realTodayParts();
  const parsed = parseInt(query.month, 10);
  const month = (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12)
    ? parsed
    : (query.month === 'all' || query.month === '0' || query.month === 0)
      ? 'all'
      : today.month;
  return {
    month,
    from: query.from || query.from_date || null,
    to: query.to || query.to_date || null,
  };
}

export function monthsOverlappingRange(from, to) {
  const start = dateOnlyParts(from);
  const end = dateOnlyParts(to);
  if (!start && !end) return null;
  const sm = start?.month || end.month;
  const em = end?.month || start.month;
  const set = new Set();
  if (sm <= em) {
    for (let m = sm; m <= em; m += 1) set.add(m);
  } else {
    for (let m = sm; m <= 12; m += 1) set.add(m);
    for (let m = 1; m <= em; m += 1) set.add(m);
  }
  return set;
}

/**
 * Birthday/anniversary match uses the real calendar month (not transaction date).
 * month=1..12 → that month; month=all → every stored date; otherwise this month.
 */
export function occasionMatches(raw, { month } = {}, now = new Date()) {
  const parts = dateOnlyParts(raw);
  if (!parts) return false;
  if (month === 'all' || month === '0' || month === 0) return true;
  const m = parseInt(month, 10);
  if (Number.isFinite(m) && m >= 1 && m <= 12) return parts.month === m;
  return parts.month === realTodayParts(now).month;
}

export function sortOccasionRows(rows, field, now = new Date()) {
  return [...rows].sort((a, b) => {
    const todayA = isTodayOccasion(a[field], now) ? 0 : 1;
    const todayB = isTodayOccasion(b[field], now) ? 0 : 1;
    if (todayA !== todayB) return todayA - todayB;
    const pa = dateOnlyParts(a[field]);
    const pb = dateOnlyParts(b[field]);
    return (pa?.day || 0) - (pb?.day || 0);
  });
}

