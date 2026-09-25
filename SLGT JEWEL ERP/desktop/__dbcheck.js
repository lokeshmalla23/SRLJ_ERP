const Database = require('better-sqlite3');
const db = new Database(process.argv[1], { readonly: true });
const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE tbl_name='employees' ORDER BY type`).all();
process.stdout.write(JSON.stringify(schema, null, 2) + '\n');
const rows = db.prepare('SELECT id, name, mobile, email, user_id FROM employees LIMIT 20').all();
process.stdout.write('ROWS:' + JSON.stringify(rows, null, 2) + '\n');
db.close();
process.exit(0);
