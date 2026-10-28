import {
  FINANCE_PORTAL_APPROVER,
  FINANCE_PORTAL_CASHIER_WRITE,
  FINANCE_PORTAL_READ,
  FINANCE_PORTAL_WRITE,
} from './finance-portal.roles';
import {
  APPROVER as PAYROLL_APPROVER,
  READ as PAYROLL_READ,
  WRITE as PAYROLL_WRITE,
} from './finance-payroll.controller';
import {
  APPROVER_ROLES,
  CASHIER_ROLES,
  FINANCE_ROLES,
  FINANCE_WRITE,
} from './finance.controller';

const ALL_SETS: Record<string, readonly string[]> = {
  FINANCE_PORTAL_READ,
  FINANCE_PORTAL_WRITE,
  FINANCE_PORTAL_CASHIER_WRITE,
  FINANCE_PORTAL_APPROVER,
  PAYROLL_READ,
  PAYROLL_WRITE,
  PAYROLL_APPROVER,
  FINANCE_ROLES,
  FINANCE_WRITE,
  APPROVER_ROLES,
  CASHIER_ROLES,
};

describe('financial portal role sets — ACCOUNTANT has the entire portal', () => {
  for (const [name, set] of Object.entries(ALL_SETS)) {
    it(`${name} includes ACCOUNTANT`, () => {
      expect(set).toContain('ACCOUNTANT');
    });
  }

  it('grants ADMIN read-only access to the portal', () => {
    expect(FINANCE_PORTAL_READ).toContain('ADMIN');
    expect(PAYROLL_READ).toContain('ADMIN');
    expect(FINANCE_PORTAL_WRITE).not.toContain('ADMIN');
    expect(FINANCE_PORTAL_CASHIER_WRITE).not.toContain('ADMIN');
    expect(FINANCE_PORTAL_APPROVER).not.toContain('ADMIN');
    expect(PAYROLL_WRITE).not.toContain('ADMIN');
    expect(PAYROLL_APPROVER).not.toContain('ADMIN');
  });
});
