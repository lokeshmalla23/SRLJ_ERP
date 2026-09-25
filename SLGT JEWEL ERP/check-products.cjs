const s = require('./backend/node_modules/sqlite3/lib/sqlite3.js');
const dbPath = process.env.APPDATA + '/jewellery-crm-desktop/data/jewellery-crm.sqlite';
const db = new s.Database(dbPath, s.OPEN_READONLY, (err) => {
  if (err) { console.log('Cannot open DB:', err.message); process.exit(1); }

  db.all("SELECT id, name, status, shop_id FROM products LIMIT 10", (e, rows) => {
    if (e) { console.log('Error:', e.message); db.close(); return; }
    console.log('Products:', rows.length);
    rows.forEach(r => console.log(` - ${r.name} | status=${r.status} | shop_id=${r.shop_id}`));

    db.get("SELECT shop_id FROM shops LIMIT 1", (e2, shop) => {
      console.log('\nShop in DB:', shop?.shop_id || 'none');

      db.get("SELECT value FROM settings WHERE key='shop_id' LIMIT 1", (e3, setting) => {
        console.log('Settings shop_id:', setting?.value || 'none');
        db.close();
      });
    });
  });
});
