/**
 * Quick crypto box round-trip test (no DB).
 * node tests/cryptoBox.test.js
 */
import assert from 'assert';
import { encryptBuffer, decryptEnvelope, deriveKeyFromSecret } from '../src/security/cryptoBox.js';

const key = deriveKeyFromSecret('test-secret-for-jewellery-erp');
const plain = Buffer.from('invoice INV-1 customer data', 'utf8');
const env = encryptBuffer(plain, key);
const out = decryptEnvelope(env, key);
assert.strictEqual(out.toString('utf8'), plain.toString('utf8'));
console.log('cryptoBox.test.js OK');
