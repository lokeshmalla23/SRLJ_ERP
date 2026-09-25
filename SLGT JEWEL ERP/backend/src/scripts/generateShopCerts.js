#!/usr/bin/env node
/**
 * Generate a shop CA + host/device certs for LAN mTLS (requires openssl on PATH).
 *
 * Usage:
 *   node src/scripts/generateShopCerts.js
 *
 * Then set:
 *   TLS_KEY_PATH=backend/.certs/host.key.pem
 *   TLS_CERT_PATH=backend/.certs/host.cert.pem
 *   TLS_CA_PATH=backend/.certs/shop-ca.cert.pem
 *   TLS_MTLS=true
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.TLS_CERT_DIR || path.resolve(__dirname, '../../.certs');
fs.mkdirSync(dir, { recursive: true });

function sh(cmd) {
  console.log('>', cmd);
  execSync(cmd, { stdio: 'inherit', cwd: dir });
}

const caKey = path.join(dir, 'shop-ca.key.pem');
const caCert = path.join(dir, 'shop-ca.cert.pem');
const hostKey = path.join(dir, 'host.key.pem');
const hostCert = path.join(dir, 'host.cert.pem');
const hostCsr = path.join(dir, 'host.csr.pem');

if (!fs.existsSync(caCert)) {
  sh(`openssl genrsa -out "${caKey}" 4096`);
  fs.chmodSync(caKey, 0o600);
  sh(`openssl req -x509 -new -nodes -key "${caKey}" -sha256 -days 3650 -out "${caCert}" -subj "/CN=JewelleryERP-ShopCA"`);
}

if (!fs.existsSync(hostCert)) {
  sh(`openssl genrsa -out "${hostKey}" 2048`);
  fs.chmodSync(hostKey, 0o600);
  sh(`openssl req -new -key "${hostKey}" -out "${hostCsr}" -subj "/CN=JewelleryERP-Host"`);
  sh(`openssl x509 -req -in "${hostCsr}" -CA "${caCert}" -CAkey "${caKey}" -CAcreateserial -out "${hostCert}" -days 825 -sha256`);
}

console.log(`
Certs ready in ${dir}

Set environment:
  TLS_KEY_PATH=${hostKey}
  TLS_CERT_PATH=${hostCert}
  TLS_CA_PATH=${caCert}
  TLS_MTLS=true
`);
