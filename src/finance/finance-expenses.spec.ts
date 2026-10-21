import { FinancePortalService } from './finance-portal.service';
import { FinanceExpensesService } from './finance.service';

const TENANT = 'tenant-1';

function fakePrisma(tx: any) {
  return {
    withTenant: async (_t: string, cb: any) => cb(tx),
    withTenantRead: async (_t: string, cb: any) => cb(tx),
  } as any;
}

function portalSvc(tx: any, expenses: any) {
  return new FinancePortalService(
    fakePrisma(tx), {} as any, {} as any, expenses, {} as any, {} as any, {} as any, {} as any,
    { recordFamilyConditionView: jest.fn(async () => undefined) } as any,
    { emitDomainEvent: jest.fn(async () => undefined) } as any,
  );
}

describe('listExpenses mapper', () => {
  it('includes vendor (payee) so the ledger can render Title & Payee', async () => {
    const expenses = {
      listExpenses: jest.fn(async () => [
        {
          id: 'e-1', categoryId: 'c-1', amount: 500, currency: 'SDG',
          date: '2026-10-01', vendor: 'Nile Fuel Co.', description: 'Generator Fuel Purchase',
          status: 'APPROVED', category: { name: 'Maintenance' },
        },
      ]),
    };
    const rows: any[] = await portalSvc({}, expenses).listExpenses(TENANT);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'e-1', categoryName: 'Maintenance', amount: 500,
      title: 'Generator Fuel Purchase', vendor: 'Nile Fuel Co.', status: 'approved',
    });
  });
});

describe('createExpense', () => {
  it('persists title as description, vendor as vendor, and the chosen date', async () => {
    const tx: any = {
      tenant: { findUnique: jest.fn(async () => ({ currencyCode: 'SDG' })) },
      expenseCategory: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 'c-9' })),
      },
      expense: {
        create: jest.fn(async (args: any) => ({ id: 'e-9', ...args.data })),
        update: jest.fn(async () => ({})),
      },
    };
    const expenses = { createExpense: jest.fn(async (_t: string, dto: any) => tx.expense.create({ data: dto })) };

    await portalSvc(tx, expenses).createExpense(TENANT, {
      category: 'Utilities', amount: 1200,
      title: 'Generator Fuel Purchase', vendor: 'Nile Fuel Co.', date: '2026-10-05',
    } as any);

    const created = tx.expense.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      vendor: 'Nile Fuel Co.', description: 'Generator Fuel Purchase',
    });
    expect(String(created.date)).toContain('2026-10-05');
  });
});

describe('FinanceExpensesService.createExpense date handling', () => {
  it('normalizes a YYYY-MM-DD date to full ISO-8601 (Prisma DateTime rejects bare dates)', async () => {
    const tx: any = {
      expense: { create: jest.fn(async (args: any) => ({ id: 'e-1', ...args.data })) },
    };
    const svc = new FinanceExpensesService(fakePrisma(tx));
    await svc.createExpense(TENANT, {
      categoryId: 'c-1', amount: 400000, currency: 'SDG',
      date: '2026-10-15', vendor: 'khalid abdulraziq', description: 'school work',
    } as any);

    const sent = tx.expense.create.mock.calls[0][0].data.date;
    expect(sent).toBe(new Date('2026-10-15').toISOString());
  });
});

describe('rejectExpense', () => {
  it('rejects an empty reason with BadRequest', async () => {
    const expenses = { rejectExpense: jest.fn(async () => ({})) };
    await expect(
      portalSvc({}, expenses).rejectExpense(TENANT, 'e-1', '   '),
    ).rejects.toThrow('Rejection reason is required');
    expect(expenses.rejectExpense).not.toHaveBeenCalled();
  });

  it('accepts a valid reason and forwards it', async () => {
    const expenses = { rejectExpense: jest.fn(async () => ({ id: 'e-1' })) };
    await portalSvc({}, expenses).rejectExpense(TENANT, 'e-1', 'Duplicate entry');
    expect(expenses.rejectExpense).toHaveBeenCalledWith(TENANT, 'e-1', 'Duplicate entry');
  });
});

describe('FinanceExpensesService.updateExpense', () => {
  const svc = (tx: any) => new FinanceExpensesService(fakePrisma(tx));

  it('updates a PENDING expense inside the tenant', async () => {
    const tx: any = {
      expense: {
        findFirst: jest.fn(async () => ({ id: 'e-1', status: 'PENDING' })),
        update: jest.fn(async (args: any) => ({ id: 'e-1', ...args.data })),
      },
    };
    const out: any = await svc(tx).updateExpense(TENANT, 'e-1', { vendor: 'New Vendor' } as any);
    expect(tx.expense.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'e-1', tenantId: TENANT }) }),
    );
    expect(out.vendor).toBe('New Vendor');
  });

  it('404s an unknown id (no blind cross-tenant write)', async () => {
    const tx: any = { expense: { findFirst: jest.fn(async () => null) } };
    await expect(svc(tx).updateExpense(TENANT, 'nope', {} as any)).rejects.toThrow('Expense not found');
  });

  it('400s a non-PENDING expense (approved records are immutable)', async () => {
    const tx: any = { expense: { findFirst: jest.fn(async () => ({ id: 'e-1', status: 'APPROVED' })) } };
    await expect(svc(tx).updateExpense(TENANT, 'e-1', {} as any)).rejects.toThrow('Only pending expenses');
  });

  it('normalizes a YYYY-MM-DD patch date to full ISO-8601', async () => {
    const tx: any = {
      expense: {
        findFirst: jest.fn(async () => ({ id: 'e-1', status: 'PENDING' })),
        update: jest.fn(async (args: any) => ({ id: 'e-1', ...args.data })),
      },
    };
    const out: any = await svc(tx).updateExpense(TENANT, 'e-1', { date: '2026-10-20' } as any);
    expect(out.date).toBe(new Date('2026-10-20').toISOString());
  });
});

describe('FinanceExpensesService.deleteExpense', () => {
  const svc = (tx: any) => new FinanceExpensesService(fakePrisma(tx));

  it('deletes a PENDING expense inside the tenant', async () => {
    const tx: any = {
      expense: {
        findFirst: jest.fn(async () => ({ id: 'e-1', status: 'PENDING' })),
        delete: jest.fn(async () => ({ id: 'e-1' })),
      },
    };
    await svc(tx).deleteExpense(TENANT, 'e-1');
    expect(tx.expense.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'e-1' }) }),
    );
  });

  it('404s an unknown id', async () => {
    const tx: any = { expense: { findFirst: jest.fn(async () => null) } };
    await expect(svc(tx).deleteExpense(TENANT, 'nope')).rejects.toThrow('Expense not found');
  });

  it('400s a PAID expense', async () => {
    const tx: any = { expense: { findFirst: jest.fn(async () => ({ id: 'e-1', status: 'PAID' })) } };
    await expect(svc(tx).deleteExpense(TENANT, 'e-1')).rejects.toThrow('Only pending expenses');
  });
});
