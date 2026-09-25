import { User, Category, CatalogItem, Setting, Shop } from './models/index.js';
import { newId } from './utils.js';
import { getDefaultShopId, clearDefaultShopCache } from './services/defaultShop.js';
import { ensurePermanentAdmin } from './services/permanentAdmin.js';
import branchConfig from './config/branchConfig.js';
import 'dotenv/config';

/** Optional jewellery defaults — only when CRM_SEED_CATALOG=1. */
async function seedDefaultCatalogAndCategories() {
  // System masters are already ensured; only add demo extras that are missing.
  const existing = await CatalogItem.findAll({
    where: { deleted_at: null },
    attributes: ['type', 'code', 'name'],
  });
  const have = new Set(
    existing.map((r) => `${r.type}:${String(r.code || r.name || '').toUpperCase()}`),
  );

  const catalogItems = [
    { type: 'metal_type', name: 'Platinum', code: 'PLATINUM', color: '#6B7280' },
    { type: 'metal_type', name: 'Diamond', code: 'DIAMOND', color: '#60A5FA' },
    { type: 'purity', name: '14K', code: '14K' },
    { type: 'purity', name: 'PT950', code: 'PT950' },
    { type: 'stone_type', name: 'Diamond', code: 'DIA' },
    { type: 'stone_type', name: 'Ruby', code: 'RUB' },
    { type: 'stone_type', name: 'Emerald', code: 'EMR' },
    { type: 'stone_type', name: 'Sapphire', code: 'SAP' },
    { type: 'stone_type', name: 'Pearl', code: 'PRL' },
    { type: 'stone_type', name: 'Kundan', code: 'KUN' },
    { type: 'stone_type', name: 'Polki', code: 'POL' },
    { type: 'stone_type', name: 'Uncut Diamond', code: 'UNCT' },
    { type: 'unit', name: 'Pair', code: 'pair' },
    { type: 'unit', name: 'Set', code: 'set' },
    { type: 'collection', name: 'Bridal Heritage', code: 'bridal-heritage' },
    { type: 'collection', name: 'Solitaire', code: 'solitaire' },
    { type: 'collection', name: 'Temple', code: 'temple' },
    { type: 'collection', name: 'Everyday', code: 'everyday' },
    { type: 'collection', name: 'Gentleman', code: 'gentleman' },
    { type: 'collection', name: 'Silver Heritage', code: 'silver-heritage' },
    { type: 'collection', name: 'Festival', code: 'festival' },
    { type: 'collection', name: 'Kids', code: 'kids' },
    { type: 'tag', name: 'New Arrival', code: 'new-arrival' },
    { type: 'tag', name: 'Best Seller', code: 'best-seller' },
    { type: 'tag', name: 'Limited Edition', code: 'limited-edition' },
    { type: 'tag', name: 'Wedding', code: 'wedding' },
    { type: 'tag', name: 'Gift', code: 'gift' },
  ].filter((item) => !have.has(`${item.type}:${String(item.code).toUpperCase()}`));

  if (catalogItems.length > 0) {
    await CatalogItem.bulkCreate(catalogItems.map((item) => ({ id: newId(), ...item })));
    console.log(`  ✓ Catalog demo extras seeded (${catalogItems.length}) (CRM_SEED_CATALOG=1)`);
  }

  const catCount = await Category.count();
  if (catCount === 0) {
    const categoryTree = [
      { name: 'Rings', subs: ['Engagement', 'Solitaire', 'Couple', 'Daily Wear', 'Bridal', 'Designer'] },
      { name: 'Necklaces', subs: ['Bridal', 'Choker', 'Long Chain', 'Layered'] },
      { name: 'Earrings', subs: ['Studs', 'Jhumka', 'Hoops', 'Danglers'] },
      { name: 'Bangles', subs: ['Kada', 'Bridal Set', 'Kundan'] },
      { name: 'Chains', subs: ['Box', 'Rope', 'Cuban', 'Snake'] },
      { name: 'Anklets', subs: ['Classic', 'Bridal', 'Kids'] },
      { name: 'Pendants', subs: ['Solitaire', 'Religious', 'Fashion'] },
    ];
    const categories = [];
    for (let i = 0; i < categoryTree.length; i++) {
      const { name, subs } = categoryTree[i];
      const parentId = newId();
      categories.push({ id: parentId, name, parent_id: null, display_order: i });
      for (let j = 0; j < subs.length; j++) {
        categories.push({ id: newId(), name: subs[j], parent_id: parentId, display_order: j });
      }
    }
    await Category.bulkCreate(categories);
    console.log('  ✓ Categories seeded (CRM_SEED_CATALOG=1)');
  }
}

export const seedDatabase = async () => {
  console.log('🌱 Checking seed data...');
  clearDefaultShopCache();

  // If a specific shop_id is configured (e.g. synced from Neon), ensure that shop exists
  // and don't create a new one — prevents duplicate seed shops.
  const configuredShopId = branchConfig.shop_id || null;

  const shopCount = await Shop.count();
  if (shopCount === 0) {
    const shopName = process.env.SHOP_NAME || 'My Jewellery Shop';
    const shopPrefix = process.env.SHOP_INVOICE_PREFIX || null;
    await Shop.create({
      id: configuredShopId || newId(),
      name: shopName,
      code: shopPrefix,
      invoice_prefix: shopPrefix,
      status: 'active',
      settings: {},
    });
    console.log('  ✓ Default shop created');
  } else if (configuredShopId) {
    // Ensure the configured shop exists (may have been pulled from Neon after initial seed)
    const exists = await Shop.findByPk(configuredShopId);
    if (!exists) {
      const shopName = process.env.SHOP_NAME || 'My Jewellery Shop';
      const shopPrefix = process.env.SHOP_INVOICE_PREFIX || null;
      await Shop.create({
        id: configuredShopId,
        name: shopName,
        code: shopPrefix,
        invoice_prefix: shopPrefix,
        status: 'active',
        settings: {},
      });
      console.log(`  ✓ Configured shop ${configuredShopId} created`);
    }
  }
  const shopId = configuredShopId || await getDefaultShopId({ forceRefresh: true });

  const userCount = await User.count();
  // Never seed a default owner on staff/replica PCs — they import the host DB after join.
  const isHostRole = (process.env.BRANCH_ROLE || 'active_host') === 'active_host';

  // ─── Permanent ERP administrator ───────────────────────────────────────────
  // Always available, independent of the owner's own credentials. Created once
  // on the host and never recreated/reset/removed afterwards. The owner creates
  // their own login from Settings → Company Profile → Update Password after
  // signing in with this account (or via /api/cluster/bootstrap-owner on first run).
  if (isHostRole) {
    await ensurePermanentAdmin(shopId);
    // Ensure shop join code exists for staff PIN / join flows
    try {
      const join = await Setting.findOne({ where: { key: 'shop_join_code' } });
      if (!join) {
        await Setting.create({
          id: newId(),
          key: 'shop_join_code',
          shop_id: shopId,
          value: { code: String(Math.floor(100000 + Math.random() * 900000)) },
        });
      }
    } catch { /* non-fatal */ }
  }

  if (userCount === 0 && !isHostRole) {
    console.log('  ✓ Replica/client — skipping default owner seed (will import from host)');
  }

  // ─── Settings ────────────────────────────────────────────────────────────
  const settingCount = await Setting.count();
  if (settingCount === 0) {
    const shopName = process.env.SHOP_NAME || 'My Jewellery Shop';
    await Setting.bulkCreate([
      {
        id: newId(),
        key: 'company',
        value: {
          name: shopName,
          address: '',
          phone: '',
          email: '',
          gstin: '',
          prefix: process.env.SHOP_INVOICE_PREFIX || '',
          logo_url: '',
        },
      },
      {
        id: newId(),
        key: 'gold_rate',
        value: {
          gold_22k: 6200,
          gold_18k: 5100,
          gold_24k: 6800,
          silver: 82,
          updated_at: new Date().toISOString(),
        },
      },
    ]);
    console.log('  ✓ Settings seeded');
  }

  // ─── System catalog masters (always) ─────────────────────────────────────
  // Gold/Silver, Grams/Piece/Tray, and standard purities are const — restored
  // after factory wipe. Extra demo catalog stays opt-in via CRM_SEED_CATALOG=1.
  try {
    const { ensureSystemCatalogItems } = await import('./services/systemCatalog.js');
    await ensureSystemCatalogItems(shopId);
    console.log('  ✓ System catalog masters ensured (metals, units, purities)');
  } catch (err) {
    console.warn('  ⚠ System catalog ensure skipped:', err.message);
  }

  // ─── Optional demo catalog / categories ──────────────────────────────────
  if (process.env.CRM_SEED_CATALOG === '1') {
    await seedDefaultCatalogAndCategories();
  }

  console.log('✅ Seed complete');
  // Host: ensure shop-specific LAN coordination secret exists (never logged)
  try {
    if ((process.env.BRANCH_ROLE || 'active_host') === 'active_host') {
      const { ensureLanSharedSecret, lanSecretFingerprint } = await import('./services/lanSecretService.js');
      const secret = await ensureLanSharedSecret(shopId);
      console.log(`  ✓ LAN coordination secret ready (fp=${lanSecretFingerprint(secret)})`);
    }
  } catch (err) {
    console.warn('  ⚠ LAN secret ensure skipped:', err.message);
  }
};
