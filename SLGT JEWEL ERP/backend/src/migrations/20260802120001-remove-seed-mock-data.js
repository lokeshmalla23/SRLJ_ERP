import { tableExists } from './_helpers.js';

const MOCK_CUSTOMER_MOBILES = [
  '9876543210', // Priya Sharma
  '9845678901', // Rahul Mehta
  '9823456789', // Anita Patel
  '9756432109', // Sunita Reddy
  '9712345678', // Vikram Singh
];

const MOCK_PRODUCT_CODES = [
  'RNG-001',
  'NCK-001',
  'EAR-001',
  'BNG-001',
  'RNG-SOL-001',
];

export async function up({ context: qi }) {
  const sequelize = qi.sequelize;

  if (await tableExists(qi, 'customers')) {
    const placeholders = MOCK_CUSTOMER_MOBILES.map((_, i) => `:m${i}`).join(', ');
    const replacements = Object.fromEntries(MOCK_CUSTOMER_MOBILES.map((m, i) => [`m${i}`, m]));
    await sequelize.query(
      `DELETE FROM customers WHERE mobile IN (${placeholders})`,
      { replacements },
    );
  }

  if (await tableExists(qi, 'products')) {
    const placeholders = MOCK_PRODUCT_CODES.map((_, i) => `:c${i}`).join(', ');
    const replacements = Object.fromEntries(MOCK_PRODUCT_CODES.map((c, i) => [`c${i}`, c]));
    await sequelize.query(
      `DELETE FROM products WHERE code IN (${placeholders})`,
      { replacements },
    );
  }
}

export async function down() {
  // No rollback — mock data should not be restored
}
