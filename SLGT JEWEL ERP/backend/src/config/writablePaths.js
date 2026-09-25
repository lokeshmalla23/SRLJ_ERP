/**
 * Writable paths for packaged Electron installs.
 * Program Files is read-only for normal users — never mkdir/write there.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../..');

/** AppData (Electron) or backend folder (dev). */
export function writableRoot() {
  if (process.env.ELECTRON_USERDATA) {
    return process.env.ELECTRON_USERDATA;
  }
  return BACKEND_ROOT;
}

export function writablePath(...parts) {
  return path.join(writableRoot(), ...parts);
}

export function backendInstallRoot() {
  return BACKEND_ROOT;
}
