/**
 * Compatibility re-export — authoritative implementation lives in shared/domain.
 * Cloud/Branch Sequelize path keeps importing from here so existing tests stay stable.
 */
export * from '../../../shared/domain/money.js';
