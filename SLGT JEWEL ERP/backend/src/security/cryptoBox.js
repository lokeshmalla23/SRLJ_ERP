/**
 * AES-256-GCM authenticated encryption for backups and sensitive blobs.
 * Keys must come from OS-protected storage / env — never beside the DB file.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALG = 'aes-256-gcm';

export function deriveKeyFromSecret(secret) {
  if (!secret) throw new Error('Backup/encryption secret required');
  return crypto.createHash('sha256').update(String(secret)).digest();
}

export function getBackupKey() {
  const secret =
    process.env.BACKUP_ENCRYPTION_KEY
    || process.env.RECOVERY_KEY
    || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('BACKUP_ENCRYPTION_KEY (or RECOVERY_KEY / JWT_SECRET) required for encrypted backups');
  }
  return deriveKeyFromSecret(secret);
}

export function encryptBuffer(plaintext, key = getBackupKey()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}

export function decryptEnvelope(envelope, key = getBackupKey()) {
  const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
}

export function writeEncryptedFile(filePath, plaintextBuffer, key = getBackupKey()) {
  const envelope = encryptBuffer(plaintextBuffer, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(envelope), { mode: 0o600 });
  return filePath;
}

export function readEncryptedFile(filePath, key = getBackupKey()) {
  const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return decryptEnvelope(envelope, key);
}
