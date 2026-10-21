import { FinanceDiscountsService } from './finance.service';
import { FinancePayrollService } from './finance-payroll.service';
import {
  bridgeFamilyConditionApproval,
  bridgeStudentDiscountApproval,
  classifyStudentDiscountSource,
  discountValueTypeFromKind,
  formatDiscountLabel,
} from './discount-eligibility.bridge';

const TENANT = 'tenant-1';

// --- pure classification ----------------------------------------------------

describe('classifyStudentDiscountSource', () => {
  it('classifies sync-composed rows (relationApplied set) as SIBLING', () => {
    expect(classifyStudentDiscountSource({ relationApplied: 'SISTERS' })).toBe('SIBLING');
  });

  it('classifies manual assigns (no relationApplied) as MANUAL', () => {
    expect(classifyStudentDiscountSource({ relationApplied: null })).toBe('MANUAL');
    expect(classifyStudentDiscountSource({})).toBe('MANUAL');
  });

  it('classifies manual sibling assigns (MANUAL_ASSIGN marker) as SIBLING', () => {
    expect(classifyStudentDiscountSource({ relationApplied: 'MANUAL_ASSIGN' })).toBe('SIBLING');
  });
});

describe('discountValueTypeFromKind', () => {
  it("maps 'percentage' to PERCENTAGE (case-insensitive)", () => {
    expect(discountValueTypeFromKind('percentage')).toBe('PERCENTAGE');
    expect(discountValueTypeFromKind('Percentage')).toBe('PERCENTAGE');
  });

  it("maps fixed variants to FIXED_AMOUNT", () => {
    expect(discountValueTypeFromKind('fixed')).toBe('FIXED_AMOUNT');
    expect(discountValueTypeFromKind('fixed_amount')).toBe('FIXED_AMOUNT');
  });

  it('returns null for unknown kinds (cannot invent semantics)', () => {
    expect(discountValueTypeFromKind('bogus')).toBeNull();
    expect(discountValueTypeFromKind(null)).toBeNull();
  });
});

describe('formatDiscountLabel', () => {
  it('labels sibling percentage with % sign', () => {
    expect(formatDiscountLabel('SIBLING', 'PERCENTAGE', 15)).toBe('Sibling Discount (15%)');
  });

  it('labels fixed amounts plainly', () => {
    expect(formatDiscountLabel('SIBLING', 'FIXED_AMOUNT', 50)).toBe('Sibling Discount (50)');
  });

  it('labels manual rows with the discount-type name', () => {
    expect(formatDiscountLabel('MANUAL', 'PERCENTAGE', 20, 'Staff child')).toBe('Staff child');
  });

  it('labels family-condition rows generically (never the reason)', () => {
    expect(formatDiscountLabel('FAMILY_CONDITION', 'FIXED_AMOUNT', 100)).toBe('Family condition');
  });
});

// --- bridge (fake tx) --------------------------------------------------------

function makeEligibilityTx(existing: any[] = []) {
  const store = [...existing];
  return {
    store,
    discountEligibility: {
      findFirst: jest.fn(async ({ where }: any) =>
        store.find((r) => r.sourceRefId === where.sourceRefId && r.tenantId === where.tenantId) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `elig-${store.length + 1}`, ...data };
        store.push(row);
        return row;
      }),
    },
  };
}

describe('bridgeStudentDiscountApproval', () => {
  it('materialises an eligibility for an approved percentage discount', async () => {
    const tx: any = makeEligibilityTx();
    const row = await bridgeStudentDiscountApproval(tx, TENANT, {
      id: 'sd-1',
      studentId: 'stu-1',
      value: 15,
      snapshotValue: 15,
      relationApplied: 'SISTERS',
      discountTypeName: 'Sibling Discount (Percentage)',
      discountTypeKind: 'percentage',
    });
    expect(row.sourceType).toBe('SIBLING');
    expect(row.valueType).toBe('PERCENTAGE');
    expect(Number(row.value)).toBe(15);
    expect(row.sourceRefId).toBe('sd-1');
    expect(row.academicYearId).toBeNull();
    expect(row.label).toBe('Sibling Discount (15%)');
    expect(tx.store).toHaveLength(1);
  });

  it('is idempotent: a second approval reuses the existing row', async () => {
    const tx: any = makeEligibilityTx();
    const input = {
      id: 'sd-1',
      studentId: 'stu-1',
      value: 15,
      snapshotValue: null,
      relationApplied: null,
      discountTypeName: 'Staff child',
      discountTypeKind: 'percentage',
    };
    const first = await bridgeStudentDiscountApproval(tx, TENANT, input);
    const second = await bridgeStudentDiscountApproval(tx, TENANT, input);
    expect(second.id).toBe(first.id);
    expect(second.sourceType).toBe('MANUAL');
    expect(tx.store).toHaveLength(1);
  });

  it('creates nothing for unknown discount-type kinds', async () => {
    const tx: any = makeEligibilityTx();
    const row = await bridgeStudentDiscountApproval(tx, TENANT, {
      id: 'sd-9',
      studentId: 'stu-1',
      value: 5,
      snapshotValue: null,
      relationApplied: null,
      discountTypeName: 'Mystery',
      discountTypeKind: 'bogus',
    });
    expect(row).toBeNull();
    expect(tx.store).toHaveLength(0);
  });
});

describe('bridgeFamilyConditionApproval', () => {
  it('materialises a FAMILY_CONDITION row without copying the reason', async () => {
    const tx: any = makeEligibilityTx();
    const row = await bridgeFamilyConditionApproval(tx, TENANT, {
      id: 'fc-1',
      studentId: 'stu-1',
      valueType: 'FIXED_AMOUNT',
      value: 100,
      reason: 'sensitive hardship detail',
    });
    expect(row.sourceType).toBe('FAMILY_CONDITION');
    expect(row.label).toBe('Family condition');
    expect(JSON.stringify(row)).not.toContain('hardship');
    expect(tx.store).toHaveLength(1);
  });

  it('is idempotent on re-approval', async () => {
    const tx: any = makeEligibilityTx();
    const input = { id: 'fc-1', studentId: 'stu-1', valueType: 'FIXED_AMOUNT' as const, value: 100, reason: 'x' };
    const first = await bridgeFamilyConditionApproval(tx, TENANT, input);
    const second = await bridgeFamilyConditionApproval(tx, TENANT, input);
    expect(second.id).toBe(first.id);
    expect(tx.store).toHaveLength(1);
  });
});

// --- service wiring (fake prisma) -------------------------------------------

function fakePrisma(tx: any) {
  return { withTenant: async (_t: string, cb: any) => cb(tx) } as any;
}

describe('FinanceDiscountsService.approveDiscount wiring', () => {
  it('approves and bridges a PENDING percentage discount', async () => {
    const discount = {
      id: 'sd-1',
      tenantId: TENANT,
      studentId: 'stu-1',
      value: 15,
      snapshotValue: null,
      relationApplied: 'SISTERS',
      status: 'PENDING',
      discountType: { name: 'Sibling Discount (Percentage)', kind: 'percentage' },
    };
    const eligTx: any = makeEligibilityTx();
    const tx: any = {
      ...eligTx,
      studentDiscount: {
        findFirst: jest.fn(async () => discount),
        update: jest.fn(async ({ data }: any) => ({ ...discount, ...data })),
      },
    };
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    const res: any = await svc.approveDiscount(TENANT, 'user-1', 'sd-1');
    expect(res.status).toBe('APPROVED');
    expect(eligTx.store).toHaveLength(1);
    expect(eligTx.store[0].sourceType).toBe('SIBLING');
  });

  it('rejects approving a non-PENDING row (no eligibility either)', async () => {
    const eligTx: any = makeEligibilityTx();
    const tx: any = {
      ...eligTx,
      studentDiscount: {
        findFirst: jest.fn(async () => ({ id: 'sd-2', status: 'APPROVED' })),
        update: jest.fn(),
      },
    };
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await expect(svc.approveDiscount(TENANT, 'user-1', 'sd-2')).rejects.toThrow();
    expect(eligTx.store).toHaveLength(0);
  });
});

describe('FinancePayrollService.approveFamilyCondition wiring', () => {
  it('approves and bridges a PENDING family-condition record', async () => {
    const eligTx: any = makeEligibilityTx();
    const record = {
      id: 'fc-1',
      tenantId: TENANT,
      studentId: 'stu-1',
      valueType: 'FIXED_AMOUNT',
      value: 100,
      reason: 'sensitive hardship detail',
      status: 'PENDING',
    };
    const tx: any = {
      ...eligTx,
      familyConditionDiscount: {
        findFirst: jest.fn(async () => record),
        update: jest.fn(async ({ data }: any) => ({ ...record, ...data })),
      },
      financialAuditLog: { create: jest.fn(async () => ({})) },
    };
    const svc = new FinancePayrollService(fakePrisma(tx));
    await svc.approveFamilyCondition(TENANT, 'user-1', 'fc-1');
    expect(eligTx.store).toHaveLength(1);
    expect(eligTx.store[0].sourceType).toBe('FAMILY_CONDITION');
    expect(JSON.stringify(eligTx.store[0])).not.toContain('hardship');
  });
});
