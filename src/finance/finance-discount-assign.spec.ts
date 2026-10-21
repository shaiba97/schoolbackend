import { FinanceDiscountsService } from './finance.service';

const TENANT = 'tenant-1';

function fakePrisma(tx: any) {
  return {
    withTenant: async (_t: string, cb: any) => cb(tx),
    withTenantRead: async (_t: string, cb: any) => cb(tx),
  } as any;
}

const STUDENT = { id: 'stu-1', tenantId: TENANT };
const TYPE = { id: 'dt-1', tenantId: TENANT, name: 'Sibling / Family', kind: 'percentage' };

function txWith(over: any = {}) {
  return {
    student: { findFirst: jest.fn(async () => STUDENT) },
    discountType: { findFirst: jest.fn(async () => TYPE), create: jest.fn(async (a: any) => ({ id: 'dt-new', ...a.data })) },
    studentDiscount: { create: jest.fn(async (a: any) => ({ id: 'sd-new', ...a.data })) },
    ...over,
  };
}

describe('assignDiscount', () => {
  it('keeps the legacy discountTypeId path and creates a PENDING row', async () => {
    const tx: any = txWith();
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    const row: any = await svc.assignDiscount(TENANT, { studentId: 'stu-1', discountTypeId: 'dt-1', value: 15 });
    expect(tx.studentDiscount.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, studentId: 'stu-1', discountTypeId: 'dt-1', value: 15, snapshotValue: 15, relationApplied: null, status: 'PENDING' },
    });
    expect(row.status).toBe('PENDING');
  });

  it('rejects unknown students instead of hitting the database FK', async () => {
    const tx: any = txWith({ student: { findFirst: jest.fn(async () => null) } });
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await expect(svc.assignDiscount(TENANT, { studentId: 'nope', discountTypeId: 'dt-1', value: 15 })).rejects.toThrow('Student not found');
    expect(tx.studentDiscount.create).not.toHaveBeenCalled();
  });

  it('rejects unknown discount types on the legacy path', async () => {
    const tx: any = txWith({ discountType: { findFirst: jest.fn(async () => null), create: jest.fn() } });
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await expect(svc.assignDiscount(TENANT, { studentId: 'stu-1', discountTypeId: 'nope', value: 15 })).rejects.toThrow('Discount type not found');
  });

  it('find-or-creates the discount type from category when no discountTypeId is given', async () => {
    const tx: any = txWith({ discountType: { findFirst: jest.fn(async () => null), create: jest.fn(async (a: any) => ({ id: 'dt-new', ...a.data })) } });
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await svc.assignDiscount(TENANT, { studentId: 'stu-1', category: 'SIBLING', valueType: 'PERCENTAGE', value: 15 });
    expect(tx.discountType.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, name: 'Sibling / Family', kind: 'percentage' },
    });
    expect(tx.studentDiscount.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, studentId: 'stu-1', discountTypeId: 'dt-new', value: 15, snapshotValue: 15, relationApplied: 'MANUAL_ASSIGN', status: 'PENDING' },
    });
  });

  it('reuses an existing type of the same name on the category path', async () => {
    const tx: any = txWith();
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await svc.assignDiscount(TENANT, { studentId: 'stu-1', category: 'TOPPER', valueType: 'FIXED_AMOUNT', value: 200, name: 'Staff child' });
    expect(tx.discountType.create).not.toHaveBeenCalled();
    // 'Staff child' resolves to the found type (TYPE mock), so the legacy id is used.
    expect(tx.studentDiscount.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, studentId: 'stu-1', discountTypeId: 'dt-1', value: 200, snapshotValue: 200, relationApplied: null, status: 'PENDING' },
    });
  });

  it('rejects the category path without a valueType', async () => {
    const tx: any = txWith();
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await expect(svc.assignDiscount(TENANT, { studentId: 'stu-1', category: 'SIBLING', value: 15 } as any)).rejects.toThrow();
    expect(tx.studentDiscount.create).not.toHaveBeenCalled();
  });

  it('rejects percentage values above 100', async () => {
    const tx: any = txWith();
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await expect(svc.assignDiscount(TENANT, { studentId: 'stu-1', discountTypeId: 'dt-1', valueType: 'PERCENTAGE', value: 500 } as any)).rejects.toThrow('between 0 and 100');
    expect(tx.studentDiscount.create).not.toHaveBeenCalled();
  });

  it('caps the legacy path against the referenced type kind', async () => {
    const tx: any = txWith();
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    // TYPE mock is kind 'percentage' → 9999 is rejected even without valueType.
    await expect(svc.assignDiscount(TENANT, { studentId: 'stu-1', discountTypeId: 'dt-1', value: 9999 })).rejects.toThrow('between 0 and 100');
    expect(tx.studentDiscount.create).not.toHaveBeenCalled();
  });

  it('leaves fixed-kind legacy values uncapped', async () => {
    const tx: any = txWith({
      discountType: { findFirst: jest.fn(async () => ({ id: 'dt-f', kind: 'fixed' })) },
    });
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await svc.assignDiscount(TENANT, { studentId: 'stu-1', discountTypeId: 'dt-f', value: 9999 });
    expect(tx.studentDiscount.create).toHaveBeenCalled();
  });

  it('rejects when the raced winner has the opposite kind', async () => {
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    const findFirst: any = jest.fn();
    findFirst.mockImplementationOnce(async () => null).mockImplementationOnce(async () => ({ id: 'dt-x', kind: 'fixed' }));
    const tx: any = txWith({
      discountType: {
        findFirst,
        create: jest.fn(async () => { throw p2002; }),
      },
    });
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await expect(svc.assignDiscount(TENANT, { studentId: 'stu-1', category: 'SIBLING', valueType: 'PERCENTAGE', value: 15 })).rejects.toThrow('different value type');
    expect(tx.studentDiscount.create).not.toHaveBeenCalled();
  });

  it('recovers from a find-or-create race by re-reading the winner', async () => {
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    const findFirst: any = jest.fn();
    findFirst.mockImplementationOnce(async () => null).mockImplementationOnce(async () => TYPE);
    const tx: any = txWith({
      discountType: {
        findFirst,
        create: jest.fn(async () => { throw p2002; }),
      },
    });
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await svc.assignDiscount(TENANT, { studentId: 'stu-1', category: 'SIBLING', valueType: 'PERCENTAGE', value: 15 });
    expect(tx.studentDiscount.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, studentId: 'stu-1', discountTypeId: 'dt-1', value: 15, snapshotValue: 15, relationApplied: 'MANUAL_ASSIGN', status: 'PENDING' },
    });
  });
});
