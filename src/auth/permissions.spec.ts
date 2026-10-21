import { hasPermission, PERMISSIONS } from './permissions';

describe('hasPermission — family-condition sensitivity (T15)', () => {
  it('grants ACCOUNTANT family-condition view and manage', () => {
    expect(hasPermission(['ACCOUNTANT'], PERMISSIONS.FAMILY_CONDITION_VIEW)).toBe(true);
    expect(hasPermission(['ACCOUNTANT'], PERMISSIONS.FAMILY_CONDITION_MANAGE)).toBe(true);
  });

  it('lets FINANCE_APPROVER view but not manage family conditions', () => {
    expect(hasPermission(['FINANCE_APPROVER'], PERMISSIONS.FAMILY_CONDITION_VIEW)).toBe(true);
    expect(hasPermission(['FINANCE_APPROVER'], PERMISSIONS.FAMILY_CONDITION_MANAGE)).toBe(false);
  });

  it('lets FINANCE_ADMIN view and manage family conditions', () => {
    expect(hasPermission(['FINANCE_ADMIN'], PERMISSIONS.FAMILY_CONDITION_VIEW)).toBe(true);
    expect(hasPermission(['FINANCE_ADMIN'], PERMISSIONS.FAMILY_CONDITION_MANAGE)).toBe(true);
  });

  it('grants ADMIN/SCHOOL_OWNER everything via the wildcard', () => {
    for (const role of ['ADMIN', 'SCHOOL_OWNER', 'PLATFORM_SUPER_ADMIN']) {
      expect(hasPermission([role], PERMISSIONS.FAMILY_CONDITION_VIEW)).toBe(true);
      expect(hasPermission([role], PERMISSIONS.FAMILY_CONDITION_MANAGE)).toBe(true);
    }
  });

  it('grants ACCOUNTANT full payroll privileges', () => {
    expect(hasPermission(['ACCOUNTANT'], PERMISSIONS.PAYROLL_VIEW)).toBe(true);
    expect(hasPermission(['ACCOUNTANT'], PERMISSIONS.PAYROLL_MANAGE)).toBe(true);
    expect(hasPermission(['ACCOUNTANT'], PERMISSIONS.PAYROLL_APPROVE)).toBe(true);
  });

  it('grants when any of a multi-role user qualifies', () => {
    expect(hasPermission(['ACCOUNTANT', 'FINANCE_APPROVER'], PERMISSIONS.FAMILY_CONDITION_VIEW)).toBe(true);
  });

  it('denies unknown or empty role sets', () => {
    expect(hasPermission(['NOT_A_ROLE'], PERMISSIONS.PAYROLL_VIEW)).toBe(false);
    expect(hasPermission([], PERMISSIONS.PAYROLL_VIEW)).toBe(false);
  });
});
