import path from 'path';
import { fileURLToPath } from 'url';
import { Umzug, SequelizeStorage } from 'umzug';
import sequelize from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createMigrator() {
  return new Umzug({
    migrations: {
      glob: ['migrations/[0-9]*.js', { cwd: path.join(__dirname) }],
      resolve: ({ name, path: migrationPath, context }) => {
        return {
          name,
          up: async () => {
            const migration = await import(`file://${migrationPath}`);
            return migration.up({ context, sequelize, queryInterface: context });
          },
          down: async () => {
            const migration = await import(`file://${migrationPath}`);
            if (!migration.down) {
              throw new Error(`Migration ${name} has no down()`);
            }
            return migration.down({ context, sequelize, queryInterface: context });
          },
        };
      },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, tableName: 'sequelize_meta' }),
    logger: console,
  });
}

export async function runMigrations() {
  const umzug = createMigrator();
  const pending = await umzug.pending();
  if (pending.length === 0) {
    console.log('Migrations: up to date.');
    return [];
  }
  console.log(`Migrations: running ${pending.length} pending…`);
  try {
    const executed = await umzug.up();
    console.log(`Migrations: applied ${executed.map((m) => m.name).join(', ')}`);
    return executed;
  } catch (err) {
    // Concurrent boots (or a retry after a successful DDL) can race on sequelize_meta
    // unique(name) and surface as Sequelize "Validation error".
    const msg = String(err?.message || err || '');
    const race = /validation error|uniqueconstraint|unique constraint|duplicate/i.test(msg);
    if (race) {
      const stillPending = await umzug.pending();
      if (stillPending.length === 0) {
        console.warn('Migrations: meta race detected but schema is up to date — continuing.');
        return [];
      }
    }
    throw err;
  }
}

export async function revertLastMigration() {
  const umzug = createMigrator();
  const reverted = await umzug.down();
  console.log(`Migrations: reverted ${reverted.map((m) => m.name).join(', ') || '(none)'}`);
  return reverted;
}

// CLI: node src/migrate.js [up|down]
const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  const cmd = process.argv[2] || 'up';
  try {
    await sequelize.authenticate();
    if (cmd === 'down') await revertLastMigration();
    else await runMigrations();
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}
