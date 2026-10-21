import { FinanceReportsService } from './finance-reports.service';

const TENANT = 'tenant-1';

function harness(tx: any) {
  const prisma: any = {
    withTenantRead: (_t: string, fn: (t: any) => any) => fn(tx),
  };
  return new FinanceReportsService(prisma);
}

function txBase(over: any = {}) {
  return {
    payment: { aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })), findMany: jest.fn(async () => []) },
    expense: { aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })), findMany: jest.fn(async () => []) },
    salaryPayout: { aggregate: jest.fn(async () => ({ _sum: { netAmount: 0 } })), findMany: jest.fn(async () => []) },
    discountApplication: { aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })), findMany: jest.fn(async () => []) },
    user: {
      findMany: jest.fn(async () => [{ id: 'u-acc', firstName: 'Hassan', lastName: 'Shaiba' }]),
    },
    ...over,
  };
}

const RANGE = { from: '2026-10-01', to: '2026-10-31' };

describe('getSummary', () => {
  it('sums only in-range COMPLETED payments and computes net', async () => {
    const tx = txBase();
    (tx.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 5000 } });
    (tx.expense.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 800 } });
    (tx.salaryPayout.aggregate as jest.Mock).mockResolvedValue({ _sum: { netAmount: 1200 } });
    (tx.discountApplication.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 300 } });
    const out: any = await harness(tx).getSummary(TENANT, RANGE.from, RANGE.to);
    expect(out.collections).toBe(5000);
    expect(out.expenses).toBe(2000);
    expect(out.discounts).toBe(300);
    expect(out.net).toBe(3000);
    const where = (tx.payment.aggregate as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toBe('COMPLETED');
    expect(where.paidAt.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('builds method shares that total 100', async () => {
    const tx = txBase();
    (tx.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 5000 } });
    (tx.payment.findMany as jest.Mock).mockResolvedValue([
      { method: 'CASH', amount: 3000 },
      { method: 'CASH', amount: 1000 },
      { method: 'BANKAK', amount: 1000 },
    ]);
    const out: any = await harness(tx).getSummary(TENANT, RANGE.from, RANGE.to);
    const total = out.byMethod.reduce((s: number, m: any) => s + m.share, 0);
    expect(total).toBeCloseTo(100, 5);
    expect(out.byMethod.find((m: any) => m.method === 'CASH')).toMatchObject({ count: 2, total: 4000, share: 80 });
  });

  it('400s an inverted range', async () => {
    await expect(harness(txBase()).getSummary(TENANT, '2026-10-31', '2026-10-01')).rejects.toThrow();
  });
});

describe('getLedger', () => {
  function ledgerTx() {
    const tx = txBase();
    (tx.payment.findMany as jest.Mock).mockResolvedValue([
      { id: 'pay1', amount: 5000, currencyCode: 'SDG', method: 'CASH', paidAt: new Date('2026-10-05T10:00:00Z'), paymentReference: 'V-001', student: { firstName: 'Lina', lastName: 'Hassan' } },
    ]);
    (tx.expense.findMany as jest.Mock).mockResolvedValue([
      { id: 'exp1', amount: 800, currency: 'SDG', date: new Date('2026-10-06T10:00:00Z'), vendor: 'Office corner', description: 'Paper', category: { name: 'Supplies' }, approvedBy: 'u-acc' },
    ]);
    (tx.salaryPayout.findMany as jest.Mock).mockResolvedValue([
      { id: 'po1', netAmount: 1200, currencyCode: 'SDG', paidAt: new Date('2026-10-07T10:00:00Z'), payslipNo: 'PS-00001', paymentMethod: 'BANKAK', approvedBy: 'u-acc', user: { firstName: 'Adil', lastName: 'Nour' } },
    ]);
    (tx.discountApplication.findMany as jest.Mock).mockResolvedValue([
      { id: 'd1', amount: 300, createdAt: new Date('2026-10-08T10:00:00Z'), student: { firstName: 'Omar', lastName: 'Ali' }, eligibility: { label: 'Sibling 10%' } },
    ]);
    return tx;
  }

  it('unions all four sources newest-first with signed amounts and badges', async () => {
    const rows: any[] = await harness(ledgerTx()).getLedger(TENANT, { ...RANGE });
    expect(rows).toHaveLength(4);
    expect(rows[0].type).toBe('DISCOUNT');
    expect(rows.map((r) => r.type)).toEqual(['DISCOUNT', 'PAYROLL', 'EXPENSE', 'COLLECTION']);
    expect(rows.find((r) => r.type === 'COLLECTION')).toMatchObject({ amount: 5000, channel: 'CASH' });
    expect(rows.find((r) => r.type === 'EXPENSE')).toMatchObject({ amount: -800, by: 'Hassan Shaiba' });
    expect(rows.find((r) => r.type === 'PAYROLL')).toMatchObject({ by: 'Hassan Shaiba' });
    expect(rows.find((r) => r.type === 'DISCOUNT')).toMatchObject({ amount: -300, by: '—' });
  });

  it("falls back to '—' for unknown approver IDs", async () => {
    const tx = txBase();
    (tx.user.findMany as jest.Mock).mockResolvedValue([]);
    (tx.expense.findMany as jest.Mock).mockResolvedValue([
      { id: 'exp9', amount: 100, currency: 'SDG', date: new Date('2026-10-06T10:00:00Z'), vendor: null, description: 'X', category: null, approvedBy: 'ghost-id' },
    ]);
    const rows: any[] = await harness(tx).getLedger(TENANT, { ...RANGE });
    expect(rows.find((r) => r.type === 'EXPENSE')).toMatchObject({ by: '—' });
  });

  it('type=expenses isolates expenses and payroll only', async () => {
    const rows: any[] = await harness(ledgerTx()).getLedger(TENANT, { ...RANGE, type: 'expenses' });
    expect(rows.map((r) => r.type).sort()).toEqual(['EXPENSE', 'PAYROLL']);
  });

  it('type=collections isolates fee collections', async () => {
    const rows: any[] = await harness(ledgerTx()).getLedger(TENANT, { ...RANGE, type: 'collections' });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('COLLECTION');
  });
});
