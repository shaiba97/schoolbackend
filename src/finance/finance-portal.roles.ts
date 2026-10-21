/** Single source of truth for finance role slugs; imported by the realtime
 *  gateway (finance room membership), which must not depend on controllers. */
export const FINANCE_ROLES = [
  'ACCOUNTANT',
] as const;

export const FINANCE_PORTAL_READ = [
  'ACCOUNTANT',
] as const;

export const FINANCE_PORTAL_WRITE = [
  'ACCOUNTANT',
] as const;

export const FINANCE_PORTAL_CASHIER_WRITE = [
  'ACCOUNTANT',
] as const;

export const FINANCE_PORTAL_APPROVER = [
  'ACCOUNTANT',
] as const;