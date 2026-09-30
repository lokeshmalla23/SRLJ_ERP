/**
 * Pure Indian Financial Year date math (01-Apr → 31-Mar). No DB access —
 * services/financialYearService.js builds on this.
 *
 *   2026-04-01 … 2027-03-31  →  code "2026-27"
 */

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Normalize a Date / ISO string / DATEONLY into "YYYY-MM-DD" (local calendar), or null. */
export function toYmd(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(YMD_RE);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Start year of the FY a date belongs to: Apr–Dec → same year, Jan–Mar → previous year. */
export function fyStartYear(value) {
  const ymd = toYmd(value);
  if (!ymd) return null;
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  return month >= 4 ? year : year - 1;
}

export function fyCodeFromStartYear(startYear) {
  const end = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${end}`;
}

/** "2026-27" → 2026 (null when malformed). */
export function startYearFromFyCode(code) {
  const m = String(code || '').trim().match(/^(?:FY\s*)?(\d{4})-(\d{2})$/i);
  if (!m) return null;
  const start = Number(m[1]);
  if (String((start + 1) % 100).padStart(2, '0') !== m[2]) return null;
  return start;
}

/** Full descriptor for the FY starting in `startYear`. */
export function fyFromStartYear(startYear) {
  const code = fyCodeFromStartYear(startYear);
  return {
    code,
    label: `FY ${code}`,
    start_year: startYear,
    start_date: `${startYear}-04-01`,
    end_date: `${startYear + 1}-03-31`,
  };
}

/** FY descriptor for a transaction/business date. */
export function fyForDate(value) {
  const start = fyStartYear(value);
  return start == null ? null : fyFromStartYear(start);
}

export function isDateInFy(value, fy) {
  const ymd = toYmd(value);
  if (!ymd || !fy) return false;
  return ymd >= fy.start_date && ymd <= fy.end_date;
}

export function previousFy(fy) {
  return fyFromStartYear(Number(fy.start_year ?? String(fy.start_date).slice(0, 4)) - 1);
}

export function nextFy(fy) {
  return fyFromStartYear(Number(fy.start_year ?? String(fy.start_date).slice(0, 4)) + 1);
}

/** "YYYY-MM-DD" minus one calendar day. */
export function dayBefore(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Reporting window for a FY: the current FY (the one holding the shop's
 * business date) runs 01-Apr → business date; any other FY runs the full year.
 */
export function fyReportRange(fy, businessDate) {
  const bd = toYmd(businessDate);
  const isCurrent = Boolean(bd && isDateInFy(bd, fy));
  return {
    from: fy.start_date,
    to: isCurrent ? bd : fy.end_date,
    is_current: isCurrent,
  };
}
