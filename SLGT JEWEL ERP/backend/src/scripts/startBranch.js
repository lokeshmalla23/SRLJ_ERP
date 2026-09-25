// Load backend/.env.branch then start Branch Service (APP_MODE=branch).
// Usage: node src/scripts/startBranch.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');
const envPath = path.join(backendRoot, '.env.branch');

if (!fs.existsSync(envPath)) {
  console.error('Missing .env.branch — run: npm run branch:bootstrap');
  process.exit(1);
}

for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  const k = t.slice(0, i);
  let v = t.slice(i + 1);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (process.env[k] == null || k === 'DATABASE_URL' || k === 'APP_MODE' || k === 'DB_SSL') {
    process.env[k] = v;
  }
}

process.env.APP_MODE = 'branch';
process.env.DB_SSL = process.env.DB_SSL || 'false';

const child = spawn(process.execPath, [path.join(backendRoot, 'src', 'index.js')], {
  cwd: backendRoot,
  env: process.env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
