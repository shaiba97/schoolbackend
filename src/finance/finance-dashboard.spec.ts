import { FinanceDashboardService } from './finance.service';

const TENANT = 'tenant-1';

function harness(tx: any) {
  const prisma: any = {
    withTenantRead: (_t: string, fn: (t: any) => any) => fn(tx),
  };
  return new FinanceDashboardService(prisma, {} as never);
}

function txBase(over: any = {}) {
  return {
    payment: { aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })), findMany: jest.fn(async () => []) },
    expense: { aggregate: jest.fn(async () => ({ _sum: { amount: 0 } })), findMany: jest.fn(async () => []) },
    salaryPayout: { aggregate: jest.fn(async () => ({ _sum: { netAmount: 0 } })), findMany: jest.fn(async () => []) },
    student: { count: jest.fn(async () => 0) },
    teacher: { count: jest.fn(async () => 0) },
    tenant: { findUnique: jest.fn(async () => ({ id: TENANT, name: 'Test School' })) },
    ...over,
  };
}

describe('getStats outflows', () => {
  it('computes outflows as approved-or-paid expenses plus paid payroll nets', async () => {
    const tx = txBase();
    (tx.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 10000 } });
    (tx.expense.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 800 } });
    (tx.salaryPayout.aggregate as jest.Mock).mockResolvedValue({ _sum: { netAmount: 1200 } });
    const out: any = await harness(tx).getStats(TENANT);
    expect(out.totalCollected).toBe(10000);
    expect(out.expenses).toBe(800);
    expect(out.payroll).toBe(1200);
    expect(out.outflows).toBe(2000);
    expect(out.netCashFlow).toBe(8000);
    expect((tx.salaryPayout.aggregate as jest.Mock).mock.calls[0][0].where).toMatchObject({ status: 'PAID' });
    expect((tx.expense.aggregate as jest.Mock).mock.calls[0][0].where).toMatchObject({
      status: { in: expect.arrayContaining(['APPROVED', 'PAID']) },
    });
  });

  it('identifies the tenant the numbers belong to', async () => {
    const tx = txBase({
      tenant: { findUnique: jest.fn(async () => ({ id: TENANT, name: 'API Test School' })) },
    });
    const out: any = await harness(tx).getStats(TENANT);
    expect(out.tenant).toMatchObject({ id: TENANT, name: 'API Test School' });
  });

  it('counts only ACTIVE students and teachers', async () => {
    const tx = txBase();
    (tx.student.count as jest.Mock).mockResolvedValue(310);
    (tx.teacher.count as jest.Mock).mockResolvedValue(77);
    const out: any = await harness(tx).getStats(TENANT);
    expect(out.totalStudents).toBe(310);
    expect(out.totalTeachers).toBe(77);
    expect((tx.student.count as jest.Mock).mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE' });
    expect((tx.teacher.count as jest.Mock).mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE' });
  });

  it('reports month-over-month collections change, null-safe on zero base', async () => {
    const tx = txBase();
    (tx.payment.aggregate as jest.Mock)
      .mockResolvedValueOnce({ _sum: { amount: 10000 } })
      .mockResolvedValueOnce({ _sum: { amount: 8000 } });
    const out: any = await harness(tx).getStats(TENANT);
    expect(out.collectionsChangePct).toBeCloseTo(25, 5);

    const tx2 = txBase();
    (tx2.payment.aggregate as jest.Mock)
      .mockResolvedValueOnce({ _sum: { amount: 500 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 } });
    const out2: any = await harness(tx2).getStats(TENANT);
    expect(out2.collectionsChangePct).toBeNull();
  });

  it('merges recent activity newest-first capped at 10 with signed amounts', async () => {
    const tx = txBase();
    (tx.payment.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: `pay${i}`, amount: 100, method: 'CASH', paidAt: new Date(`2026-10-${String(20 - i).padStart(2, '0')}T10:00:00Z`),
        paymentReference: `V-${i}`, student: { firstName: 'S', lastName: `${i}` },
      })),
    );
    (tx.expense.findMany as jest.Mock).mockResolvedValue([
      { id: 'e1', amount: 50, date: new Date('2026-10-21T10:00:00Z'), vendor: 'Shop', description: null, category: { name: 'Supplies' } },
    ]);
    (tx.salaryPayout.findMany as jest.Mock).mockResolvedValue([
      { id: 'p1', netAmount: 900, paidAt: new Date('2026-10-22T10:00:00Z'), payslipNo: 'PS-1', paymentMethod: 'BANKAK', user: { firstName: 'Adil', lastName: 'Nour' } },
    ]);
    const out: any = await harness(tx).getStats(TENANT);
    expect(out.recentActivity).toHaveLength(10);
    expect(out.recentActivity[0].type).toBe('PAYROLL');
    expect(out.recentActivity.find((r: any) => r.type === 'COLLECTION')).toMatchObject({ amount: 100 });
    expect(out.recentActivity.find((r: any) => r.type === 'EXPENSE')).toMatchObject({ amount: -50 });
  });
});
