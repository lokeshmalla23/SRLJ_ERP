/**
 * App runtime mode configuration.
 * cloud  — hosted API + cloud Postgres (default)
 * branch — future Branch Service + local Postgres
 *
 * Phase 2 only introduces the switch; Branch Service behavior comes in Phase 5.
 */
export const APP_MODE = (process.env.APP_MODE || 'cloud').toLowerCase();

export const isBranchMode = () => APP_MODE === 'branch';
export const isCloudMode = () => APP_MODE !== 'branch';
