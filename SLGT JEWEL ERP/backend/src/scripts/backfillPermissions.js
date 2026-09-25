// One-off migration: adds default permissions for newly-introduced modules
// (vendors, purchases, orders, quotations, barcodes, employees, accounts,
// promotions, stock, backup) to existing users, without touching modules
// they already have entries for. Safe to re-run.
import sequelize from '../db.js';
import { User } from '../models/index.js';
import { defaultPermissionsForRole } from '../constants.js';

const run = async () => {
  await sequelize.authenticate();

  const users = await User.findAll();
  let updated = 0;

  for (const user of users) {
    const current = user.permissions || {};
    const defaults = defaultPermissionsForRole(user.role);
    const missingModules = Object.keys(defaults).filter((mod) => current[mod] === undefined);

    if (missingModules.length === 0) {
      console.log(`  = ${user.email}: no missing modules`);
      continue;
    }

    const merged = { ...current };
    for (const mod of missingModules) {
      merged[mod] = defaults[mod];
    }

    await user.update({ permissions: merged });
    updated += 1;
    console.log(`  + ${user.email}: added [${missingModules.join(', ')}]`);
  }

  console.log(`\nDone. Updated ${updated}/${users.length} user(s).`);
  await sequelize.close();
};

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
