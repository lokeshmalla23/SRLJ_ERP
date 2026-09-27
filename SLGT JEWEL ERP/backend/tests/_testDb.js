/**
 * Shared bootstrap for tests that must run on a throwaway database:
 *   SQLITE_PATH=/tmp/x.sqlite node tests/<file>.test.js
 * Builds the schema exactly like boot (ensureLocalSqliteSchema + sync) and
 * seeds the default shop/COA so services have something to work with.
 */
import sequelize from '../src/db.js';

export async function bootTestDb() {
  await sequelize.authenticate();
  if (sequelize.getDialect() === 'sqlite') {
    const { ensureLocalSqliteSchema } = await import('../src/services/ensureLocalSqliteSchema.js');
    await ensureLocalSqliteSchema();
  }
  await sequelize.sync({ alter: false });
  const { seedDatabase } = await import('../src/seed.js');
  await seedDatabase();
  return sequelize;
}

/** Minimal Express res double. */
export function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
