import 'dotenv/config';
import sequelize from '../db.js';
import { User } from '../models/index.js';
import { normalizePermissionsObject, isCanonicalPermissions } from '../permissions.js';

async function run() {
  await sequelize.authenticate();
  const users = await User.findAll();
  let updated = 0;

  for (const user of users) {
    if (isCanonicalPermissions(user.permissions)) {
      console.log(`  = ${user.email}: already canonical`);
      continue;
    }
    const normalized = normalizePermissionsObject(user.permissions);
    await user.update({ permissions: normalized });
    updated += 1;
    console.log(`  + ${user.email}: normalized`);
  }

  console.log(`Done. Updated ${updated}/${users.length}`);
  await sequelize.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
