import { FinancePortalService } from './finance-portal.service';

const TENANT = 'tenant-1';

function fakePrisma(tx: any) {
  return {
    withTenant: async (_t: string, cb: any) => cb(tx),
    withTenantRead: async (_t: string, cb: any) => cb(tx),
  } as any;
}

function svc(tx: any, payroll?: any) {
  return new FinancePortalService(
    fakePrisma(tx), {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    payroll ?? { recordFamilyConditionView: jest.fn(async () => undefined) },
    { emitDomainEvent: jest.fn(async () => undefined) } as any,
  );
}

const STU = (over: any = {}) => ({
  firstName: 'Amina',
  lastName: 'Khalid',
  educationLevel: 'secondary',
  grade: '3',
  ...over,
});

describe('listAssignedDiscounts', () => {
  it('unions student discounts, family conditions, and topper eligibilities into one ledger', async () => {
    const tx: any = {
      studentDiscount: {
        findMany: jest.fn(async () => [
          {
            id: 'sd-1', studentId: 'stu-1', value: 15, relationApplied: 'SISTERS', status: 'PENDING',
            student: STU(), discountType: { name: 'Sibling / Family', kind: 'percentage' },
          },
        ]),
      },
      familyConditionDiscount: {
        findMany: jest.fn(async () => [
          {
            id: 'fc-1', studentId: 'stu-2', valueType: 'FIXED_AMOUNT', value: 200,
            reason: 'Concession approved by Principal', status: 'APPROVED',
            student: STU({ firstName: 'Omar', lastName: 'Haddad' }),
          },
        ]),
      },
      discountEligibility: {
        findMany: jest.fn(async () => [
          {
            id: 'e-1', studentId: 'stu-3', sourceType: 'TOPPER', valueType: 'PERCENTAGE',
            value: 10, label: 'Topper of 5A', expiresAt: null,
            student: STU({ firstName: 'Lina', lastName: 'Nasser' }),
            academicYear: { name: '2026-2027' },
          },
        ]),
      },
    };
    const rows: any[] = await svc(tx).listAssignedDiscounts(TENANT, 'user-1', true);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: 'sd-1', source: 'STUDENT_DISCOUNT', category: 'SIBLING',
      studentName: 'Amina Khalid', grade: 'Secondary, Grade 3',
      name: 'Sibling / Family', valueType: 'PERCENTAGE', value: 15,
      status: 'pending', actions: ['approve', 'reject'],
    });
    expect(rows[1]).toMatchObject({
      id: 'fc-1', source: 'FAMILY_CONDITION', category: 'SPECIAL_DISCRETION',
      studentName: 'Omar Haddad', valueType: 'FIXED_AMOUNT', value: 200,
      notes: 'Concession approved by Principal', status: 'approved', actions: [],
    });
    expect(rows[2]).toMatchObject({
      id: 'e-1', source: 'TOPPER', category: 'TOPPER',
      studentName: 'Lina Nasser', name: 'Topper of 5A',
      academicYear: '2026-2027', status: 'active', actions: [],
    });
  });

  it('classifies rows without relationApplied as MANUAL and hides actions once decided', async () => {
    const tx: any = {
      studentDiscount: {
        findMany: jest.fn(async () => [
          {
            id: 'sd-2', studentId: 'stu-1', value: 100, relationApplied: null, status: 'REJECTED',
            student: STU(), discountType: { name: 'Staff child', kind: 'fixed' },
          },
        ]),
      },
      familyConditionDiscount: { findMany: jest.fn(async () => []) },
      discountEligibility: { findMany: jest.fn(async () => []) },
    };
    const rows: any[] = await svc(tx).listAssignedDiscounts(TENANT, 'user-1', true);
    expect(rows[0]).toMatchObject({ category: 'MANUAL', status: 'rejected', actions: [] });
  });

  it('redacts family-condition notes when the caller may not view the reason', async () => {
    const tx: any = {
      studentDiscount: { findMany: jest.fn(async () => []) },
      familyConditionDiscount: {
        findMany: jest.fn(async () => [
          {
            id: 'fc-2', studentId: 'stu-2', valueType: 'PERCENTAGE', value: 20,
            reason: 'Sensitive hardship detail', status: 'PENDING', student: STU(),
          },
        ]),
      },
      discountEligibility: { findMany: jest.fn(async () => []) },
    };
    const rows: any[] = await svc(tx).listAssignedDiscounts(TENANT, 'user-1', false);
    expect(rows[0]).toMatchObject({ notes: null, status: 'pending', actions: ['approve', 'reject'] });
  });

  it('marks topper rows expired once expiresAt passes', async () => {
    const tx: any = {
      studentDiscount: { findMany: jest.fn(async () => []) },
      familyConditionDiscount: { findMany: jest.fn(async () => []) },
      discountEligibility: {
        findMany: jest.fn(async () => [
          {
            id: 'e-9', studentId: 'stu-3', sourceType: 'TOPPER', valueType: 'PERCENTAGE',
            value: 10, label: 'Topper of 5A', expiresAt: new Date('2020-01-01T00:00:00Z'),
            student: STU(), academicYear: { name: '2019-2020' },
          },
        ]),
      },
    };
    const rows: any[] = await svc(tx).listAssignedDiscounts(TENANT, 'user-1', true);
    expect(rows[0]).toMatchObject({ status: 'expired', actions: [] });
  });

  it('records the family-condition view audit when reasons are visible', async () => {
    const tx: any = {
      studentDiscount: { findMany: jest.fn(async () => []) },
      familyConditionDiscount: { findMany: jest.fn(async () => []) },
      discountEligibility: { findMany: jest.fn(async () => []) },
    };
    const payroll = { recordFamilyConditionView: jest.fn(async () => undefined) };
    await svc(tx, payroll).listAssignedDiscounts(TENANT, 'user-1', true);
    expect(payroll.recordFamilyConditionView).toHaveBeenCalledWith(TENANT, 'user-1');
  });

  it('skips the view audit when reasons are redacted', async () => {
    const tx: any = {
      studentDiscount: { findMany: jest.fn(async () => []) },
      familyConditionDiscount: { findMany: jest.fn(async () => []) },
      discountEligibility: { findMany: jest.fn(async () => []) },
    };
    const payroll = { recordFamilyConditionView: jest.fn(async () => undefined) };
    await svc(tx, payroll).listAssignedDiscounts(TENANT, 'user-1', false);
    expect(payroll.recordFamilyConditionView).not.toHaveBeenCalled();
  });
});
