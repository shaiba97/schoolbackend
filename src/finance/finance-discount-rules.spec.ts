import { FinanceDiscountsService } from './finance.service';

const TENANT = 'tenant-1';

function fakePrisma(tx: any) {
  return {
    withTenant: async (_t: string, cb: any) => cb(tx),
    withTenantRead: async (_t: string, cb: any) => cb(tx),
  } as any;
}

describe('listDiscountRules', () => {
  it('unions sibling rules, topper rules, and discount types into one rule list', async () => {
    const tx: any = {
      siblingDiscountRule: {
        findMany: jest.fn(async () => [
          { id: 'sr-1', name: 'Sisters 2+', relationType: 'SISTERS', minSiblingCount: 2, valueType: 'PERCENTAGE', value: 10, isActive: true },
        ]),
      },
      topperDiscountRule: {
        findMany: jest.fn(async () => [
          { id: 'tr-1', name: 'Topper 10%', valueType: 'PERCENTAGE', value: 10, isActive: true },
        ]),
      },
      discountType: {
        findMany: jest.fn(async () => [
          { id: 'dt-1', name: 'Staff child', kind: 'fixed' },
        ]),
      },
    };
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    const rows: any[] = await svc.listDiscountRules(TENANT);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: 'sr-1', source: 'SIBLING_RULE', category: 'SIBLING',
      name: 'Sisters 2+', valueType: 'PERCENTAGE', value: 10, isActive: true,
    });
    expect(rows[0].description).toMatch(/min 2 sibling/);
    expect(rows[1]).toMatchObject({
      id: 'tr-1', source: 'TOPPER_RULE', category: 'TOPPER',
      valueType: 'PERCENTAGE', value: 10, isActive: true,
    });
    expect(rows[2]).toMatchObject({
      id: 'dt-1', source: 'DISCOUNT_TYPE', category: 'MANUAL',
      name: 'Staff child', valueType: 'FIXED_AMOUNT', value: null, isActive: true,
    });
  });

  it('returns an empty list when no rules exist', async () => {
    const tx: any = {
      siblingDiscountRule: { findMany: jest.fn(async () => []) },
      topperDiscountRule: { findMany: jest.fn(async () => []) },
      discountType: { findMany: jest.fn(async () => []) },
    };
    const svc = new FinanceDiscountsService(fakePrisma(tx));
    await expect(svc.listDiscountRules(TENANT)).resolves.toEqual([]);
  });
});
