import {
  FINANCE_PORTAL_APPROVER,
  FINANCE_PORTAL_CASHIER_WRITE,
  FINANCE_PORTAL_READ,
  FINANCE_PORTAL_WRITE,
} from './finance-portal.roles';

const allowed = (roles: readonly string[], required: readonly string[]) =>
  required.some((role) => roles.includes(role));

describe('finance portal route roles — ACCOUNTANT writes, ADMIN may read', () => {
  it('lets ACCOUNTANT read the fee catalog', () => {
    expect(allowed(['ACCOUNTANT'], FINANCE_PORTAL_READ)).toBe(true);
  });

  it('lets ACCOUNTANT manage fee categories and structures', () => {
    expect(allowed(['ACCOUNTANT'], FINANCE_PORTAL_WRITE)).toBe(true);
  });

  it('lets ACCOUNTANT record payments (no separate CASHIER role)', () => {
    expect(allowed(['ACCOUNTANT'], FINANCE_PORTAL_CASHIER_WRITE)).toBe(true);
  });

  it('lets ACCOUNTANT verify payments and approve discounts/expenses', () => {
    expect(allowed(['ACCOUNTANT'], FINANCE_PORTAL_APPROVER)).toBe(true);
  });

  it('lets ADMIN read the financial portal without write access', () => {
    expect(allowed(['ADMIN'], FINANCE_PORTAL_READ)).toBe(true);
    expect(allowed(['ADMIN'], FINANCE_PORTAL_WRITE)).toBe(false);
    expect(allowed(['ADMIN'], FINANCE_PORTAL_CASHIER_WRITE)).toBe(false);
    expect(allowed(['ADMIN'], FINANCE_PORTAL_APPROVER)).toBe(false);
  });

  it('keeps AUDITOR and CASHIER read-only', () => {
    expect(allowed(['AUDITOR'], FINANCE_PORTAL_WRITE)).toBe(false);
    expect(allowed(['CASHIER'], FINANCE_PORTAL_WRITE)).toBe(false);
  });
});