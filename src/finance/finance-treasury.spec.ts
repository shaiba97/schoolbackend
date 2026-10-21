import { FinancePortalService } from './finance-portal.service';
import { FinanceCashService } from './finance.service';

const TENANT = 'tenant-1';

function fakePrisma(tx: any) {
  return {
    withTenant: async (_t: string, cb: any) => cb(tx),
    withTenantRead: async (_t: string, cb: any) => cb(tx),
  } as any;
}

function portalSvc(tx: any, cash: any) {
  return new FinancePortalService(
    fakePrisma(tx), {} as any, {} as any, {} as any, cash, {} as any, {} as any, {} as any,
    { recordFamilyConditionView: jest.fn(async () => undefined) } as any,
    { emitDomainEvent: jest.fn(async () => undefined) } as any,
  );
}

describe('listClosings mapper', () => {
  it('derives CLOSED for balanced rows and FLAGGED_REVIEW for discrepancies, with cashier names', async () => {
    const cash = {
      listClosings: jest.fn(async () => [
        {
          id: 'cl-1', accountId: 'a-1', date: '2026-10-15T00:00:00.000Z',
          closingAmount: 5000, countedAmount: 5000, discrepancy: 0,
          closedBy: 'u-1', account: { name: 'Main Cash Drawer' },
        },
        {
          id: 'cl-2', accountId: 'a-1', date: '2026-10-14T00:00:00.000Z',
          closingAmount: 5000, countedAmount: 4995, discrepancy: -5,
          closedBy: 'u-2', account: { name: 'Main Cash Drawer' },
        },
      ]),
    };
    const tx: any = {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'u-1' ? { firstName: 'Sara', lastName: 'Ahmed' } : { firstName: 'Omar', lastName: null },
        ),
      },
    };
    const rows: any[] = await portalSvc(tx, cash).listClosings(TENANT);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'cl-1', accountName: 'Main Cash Drawer', cashierName: 'Sara Ahmed',
      expected: 5000, counted: 5000, variance: 0, status: 'CLOSED',
    });
    expect(rows[1]).toMatchObject({
      id: 'cl-2', cashierName: 'Omar', variance: -5, status: 'FLAGGED_REVIEW',
    });
  });
});

describe('getExpectedCash', () => {
  it('returns credits minus debits for the account (mirrors closing math)', async () => {
    const cash = { getExpectedCash: jest.fn(async () => 4750.5) };
    const out: any = await portalSvc({}, cash).getExpectedCash(TENANT, 'a-1', '2026-10-15');
    expect(out).toMatchObject({ accountId: 'a-1', expected: 4750.5 });
    expect(cash.getExpectedCash).toHaveBeenCalledWith(TENANT, 'a-1');
  });
});

describe('FinanceCashService.transferFunds', () => {
  const svc = (tx: any) => new FinanceCashService(fakePrisma(tx));
  const accounts = () => ({
    'a-1': { id: 'a-1', name: 'Main Cash Drawer', currency: 'SDG' },
    'a-2': { id: 'a-2', name: 'Bankak Account', currency: 'SDG' },
  });

  function txWith(accts: any = accounts()) {
    const created: any[] = [];
    return {
      created,
      financialAccount: {
        findFirst: jest.fn(async ({ where }: any) => accts[where.id] ?? null),
      },
      financialTransaction: {
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `t-${created.length + 1}`, occurredAt: new Date(), ...data };
          created.push(row);
          return row;
        }),
      },
    } as any;
  }

  it('writes a paired DEBIT/CREDIT sharing one transfer token', async () => {
    const tx = txWith();
    const out: any = await svc(tx).transferFunds(TENANT, 'u-1', {
      fromAccountId: 'a-1', toAccountId: 'a-2', amount: 10000, reference: 'SLIP-42',
    });

    expect(tx.created).toHaveLength(2);
    const [debit, credit] = tx.created;
    expect(debit).toMatchObject({ accountId: 'a-1', type: 'DEBIT', amount: 10000 });
    expect(credit).toMatchObject({ accountId: 'a-2', type: 'CREDIT', amount: 10000 });
    expect(debit.referenceType).toMatch(/^XFER:/);
    expect(credit.referenceType).toBe(debit.referenceType);
    expect(debit.reference).toBe('SLIP-42');
    expect(out).toMatchObject({ fromAccountId: 'a-1', toAccountId: 'a-2', amount: 10000 });
  });

  it('400s a transfer into the same account', async () => {
    await expect(
      svc(txWith()).transferFunds(TENANT, 'u-1', { fromAccountId: 'a-1', toAccountId: 'a-1', amount: 5 }),
    ).rejects.toThrow('different accounts');
  });

  it('404s an unknown account (no blind cross-tenant writes)', async () => {
    await expect(
      svc(txWith()).transferFunds(TENANT, 'u-1', { fromAccountId: 'a-1', toAccountId: 'nope', amount: 5 }),
    ).rejects.toThrow('Account not found');
  });

  it('400s a non-positive amount', async () => {
    await expect(
      svc(txWith()).transferFunds(TENANT, 'u-1', { fromAccountId: 'a-1', toAccountId: 'a-2', amount: 0 }),
    ).rejects.toThrow('greater than zero');
  });
});

describe('listTransfers mapper', () => {
  it('pairs DEBIT/CREDIT legs sharing a token into one transfer row', async () => {
    const cash = {
      listTransactions: jest.fn(async () => [
        {
          id: 't-1', accountId: 'a-1', type: 'DEBIT', amount: 10000,
          reference: 'SLIP-42', referenceType: 'XFER:tok-1', occurredAt: '2026-10-15T10:00:00.000Z',
        },
        {
          id: 't-2', accountId: 'a-2', type: 'CREDIT', amount: 10000,
          reference: 'SLIP-42', referenceType: 'XFER:tok-1', occurredAt: '2026-10-15T10:00:00.000Z',
        },
        {
          id: 't-3', accountId: 'a-1', type: 'CREDIT', amount: 500,
          reference: 'fee collection', referenceType: null, occurredAt: '2026-10-15T11:00:00.000Z',
        },
      ]),
      listAccounts: jest.fn(async () => [
        { id: 'a-1', name: 'Main Cash Drawer' },
        { id: 'a-2', name: 'Bankak Account' },
      ]),
    };
    const rows: any[] = await portalSvc({}, cash).listTransfers(TENANT);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fromAccountName: 'Main Cash Drawer', toAccountName: 'Bankak Account',
      amount: 10000, reference: 'SLIP-42',
    });
  });
});

describe('FinanceCashService.dailyClosing guards', () => {
  const svc = (tx: any) => new FinanceCashService(fakePrisma(tx));

  it('turns a duplicate close for the same account+date into a friendly 400', async () => {
    const err: any = new Error('Unique constraint failed');
    err.code = 'P2002';
    const tx: any = {
      financialAccount: { findFirst: jest.fn(async () => ({ id: 'a-1' })) },
      financialTransaction: { findMany: jest.fn(async () => []) },
      dailyCashClosing: { create: jest.fn(async () => { throw err; }) },
    };
    await expect(
      svc(tx).dailyClosing(TENANT, 'u-1', { accountId: 'a-1', date: '2026-10-15', countedAmount: 100 } as any),
    ).rejects.toThrow('already exists');
  });

  it('404s an account outside the tenant', async () => {
    const tx: any = { financialAccount: { findFirst: jest.fn(async () => null) } };
    await expect(
      svc(tx).dailyClosing(TENANT, 'u-1', { accountId: 'nope', date: '2026-10-15', countedAmount: 100 } as any),
    ).rejects.toThrow('Account not found');
  });
});
