/**
 * node tests/occasionDate.test.js
 */
import assert from 'assert';
import {
  dateOnlyParts,
  formatDateOnly,
  occasionMatches,
  isTodayOccasion,
  sortOccasionRows,
  normalizeOccasionQuery,
} from '../src/utils/occasionDate.js';

assert.deepStrictEqual(dateOnlyParts('1982-09-03'), { year: 1982, month: 9, day: 3 });
assert.strictEqual(formatDateOnly('1982-09-03T00:00:00.000Z'), '1982-09-03');
assert.deepStrictEqual(dateOnlyParts(new Date('1982-09-03T00:00:00.000Z')), {
  year: 1982, month: 9, day: 3,
});
assert.strictEqual(dateOnlyParts(''), null);
assert.strictEqual(dateOnlyParts(null), null);

assert.strictEqual(occasionMatches('1982-09-03', { month: 9 }), true);
assert.strictEqual(occasionMatches('1982-09-03', { month: 8 }), false);
assert.strictEqual(occasionMatches('1982-09-03', { month: 'all' }), true);
assert.strictEqual(occasionMatches('', { month: 9 }), false);

const now = new Date(2026, 8, 16); // 16 Sep 2026 local
assert.strictEqual(isTodayOccasion('1990-09-16', now), true);
assert.strictEqual(isTodayOccasion('1990-09-15', now), false);
assert.strictEqual(occasionMatches('1994-09-20', {}, now), true);
assert.strictEqual(occasionMatches('1979-07-25', {}, now), false);

const sorted = sortOccasionRows([
  { name: 'Later', dob: '1988-09-20' },
  { name: 'Today', dob: '1990-09-16' },
  { name: 'Earlier', dob: '1982-09-03' },
], 'dob', now);
assert.deepStrictEqual(sorted.map((r) => r.name), ['Today', 'Earlier', 'Later']);

assert.strictEqual(normalizeOccasionQuery({ month: '9' }).month, 9);
assert.strictEqual(normalizeOccasionQuery({ month: 'all' }).month, 'all');

console.log('occasionDate.test.js ok');
