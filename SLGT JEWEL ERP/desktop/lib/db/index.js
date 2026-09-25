/**
 * Desktop local database bootstrap.
 * Creates/opens SQLite under userData/data and runs migrations.
 */
const { openDatabase, closeDatabase, checkpointWal, integrityCheck, backupDatabase, resolveDbPath } = require('./sqlite');
const { migrate, getSchemaVersion } = require('./migrate');

let singleton = null;

async function initLocalDb(userDataPath) {
  const { db, dbPath } = openDatabase(userDataPath);
  const migration = await migrate(db, userDataPath);
  // Integrity already checked inside migrate(); re-check here for defense in depth
  const integrity = integrityCheck(db);
  if (!integrity.ok) {
    closeDatabase(db);
    throw new Error(`SQLite integrity_check failed after migration: ${integrity.result}`);
  }
  checkpointWal(db);
  singleton = { db, dbPath, userDataPath, schemaVersion: getSchemaVersion(db) };
  return {
    dbPath,
    schemaVersion: singleton.schemaVersion,
    migration,
    integrity,
  };
}

function getLocalDb() {
  if (!singleton) return null;
  return singleton.db;
}

function shutdownLocalDb() {
  if (!singleton) return;
  closeDatabase(singleton.db);
  singleton = null;
}

async function backupLocalDb() {
  const s = singleton;
  if (!s) throw new Error('Local SQLite not initialized');
  return backupDatabase(s.db, s.userDataPath);
}

function getLocalDbStatus() {
  if (!singleton) {
    return { ready: false };
  }
  return {
    ready: true,
    dbPath: singleton.dbPath,
    schemaVersion: singleton.schemaVersion,
  };
}

module.exports = {
  initLocalDb,
  getLocalDb,
  shutdownLocalDb,
  backupLocalDb,
  getLocalDbStatus,
  resolveDbPath,
};
