import { FinanceControlsService } from './finance.service';

const TENANT = 'tenant-1';
const USER = 'user-accountant';

function harness(tx: any) {
  const prisma: any = {
    withTenant: (_t: string, fn: (t: any) => any) => fn(tx),
    withTenantRead: (_t: string, fn: (t: any) => any) => fn(tx),
  };
  return new FinanceControlsService(prisma);
}

function txBase(over: any = {}) {
  return {
    financialPeriod: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: any) => ({ id: 'p1', ...args.data })),
      update: jest.fn(async (args: any) => ({ id: 'p1', ...args.data })),
    },
    financialPaymentMethod: {
      findFirst: jest.fn(async () => null),
      update: jest.fn(async (args: any) => ({ id: 'm1', ...args.data })),
    },
    approvalThreshold: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: any) => ({ id: 't1', ...args.data })),
      update: jest.fn(async (args: any) => ({ id: 't1', ...args.data })),
      delete: jest.fn(async () => ({})),
    },
    role: { findMany: jest.fn(async () => []) },
    tenant: {
      findUnique: jest.fn(async () => ({ id: TENANT, currencyCode: 'SDG', settings: {} })),
      update: jest.fn(async (args: any) => ({ id: TENANT, ...args.data })),
    },
    ...over,
  };
}

describe('period lock/unlock', () => {
  it('locks an open period with audit trail fields', async () => {
    const tx = txBase({
      financialPeriod: {
        findFirst: jest.fn(async () => ({ id: 'p1', isClosed: false })),
        update: jest.fn(async (args: any) => ({ id: 'p1', ...args.data })),
      },
    });
    const out: any = await harness(tx).setPeriodLock(TENANT, USER, 'p1', true);
    expect(tx.financialPeriod.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isClosed: true, closedBy: USER }) }),
    );
    expect(out.isClosed).toBe(true);
  });

  it('400s locking an already-locked period', async () => {
    const tx = txBase({
      financialPeriod: { findFirst: jest.fn(async () => ({ id: 'p1', isClosed: true })) },
    });
    await expect(harness(tx).setPeriodLock(TENANT, USER, 'p1', true)).rejects.toThrow(/already locked/i);
  });

  it('unlocks a locked period and clears audit fields', async () => {
    const tx = txBase({
      financialPeriod: {
        findFirst: jest.fn(async () => ({ id: 'p1', isClosed: true })),
        update: jest.fn(async (args: any) => ({ id: 'p1', ...args.data })),
      },
    });
    await harness(tx).setPeriodLock(TENANT, USER, 'p1', false);
    expect(tx.financialPeriod.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isClosed: false, closedBy: null, closedAt: null }) }),
    );
  });

  it('404s an unknown period', async () => {
    await expect(harness(txBase()).setPeriodLock(TENANT, USER, 'nope', true)).rejects.toThrow();
  });
});

describe('payment method controls', () => {
  it('toggles a channel active flag', async () => {
    const tx = txBase({
      financialPaymentMethod: {
        findFirst: jest.fn(async () => ({ id: 'm1', isActive: true })),
        update: jest.fn(async (args: any) => ({ id: 'm1', ...args.data })),
      },
    });
    const out: any = await harness(tx).setMethodActive(TENANT, 'm1', false);
    expect(out.isActive).toBe(false);
  });

  it('updates receipt-display account details', async () => {
    const tx = txBase({
      financialPaymentMethod: {
        findFirst: jest.fn(async () => ({ id: 'm1' })),
        update: jest.fn(async (args: any) => ({ id: 'm1', ...args.data })),
      },
    });
    await harness(tx).setMethodDetails(TENANT, 'm1', { accountName: 'Bankak Ops', accountNumber: '12345' });
    expect(tx.financialPaymentMethod.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accountName: 'Bankak Ops', accountNumber: '12345' }) }),
    );
  });
});

describe('approval thresholds', () => {
  function rolesTx(slugs: string[]) {
    const tx = txBase();
    (tx.role.findMany as jest.Mock).mockResolvedValue(slugs.map((slug) => ({ slug })));
    return tx;
  }

  it('creates a threshold for a real role slug', async () => {
    const tx = rolesTx(['ACCOUNTANT', 'PRINCIPAL']);
    const out: any = await harness(tx).createThreshold(TENANT, {
      module: 'expenses', threshold: 500, approverRole: 'PRINCIPAL',
    });
    expect(tx.approvalThreshold.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ module: 'expenses', approverRole: 'PRINCIPAL' }) }),
    );
    expect(out.approverRole).toBe('PRINCIPAL');
  });

  it('400s an unknown approver role', async () => {
    await expect(
      harness(rolesTx(['ACCOUNTANT'])).createThreshold(TENANT, {
        module: 'expenses', threshold: 500, approverRole: 'NOPE',
      }),
    ).rejects.toThrow(/unknown role/i);
  });

  it('400s a negative threshold', async () => {
    await expect(
      harness(rolesTx(['PRINCIPAL'])).createThreshold(TENANT, {
        module: 'expenses', threshold: -5, approverRole: 'PRINCIPAL',
      }),
    ).rejects.toThrow();
  });

  it('lists thresholds ordered by module', async () => {
    const tx = txBase();
    await harness(tx).listThresholds(TENANT);
    expect(tx.approvalThreshold.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { module: 'asc' } }),
    );
  });

  it('deletes a threshold', async () => {
    const tx = txBase({
      approvalThreshold: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => ({ id: 't1' })),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(async () => ({})),
      },
    });
    await harness(tx).deleteThreshold(TENANT, 't1');
    expect(tx.approvalThreshold.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
  });
});

describe('financial settings', () => {
  it('reads currency plus finance settings bag with defaults', async () => {
    const out: any = await harness(txBase()).getFinanceSettings(TENANT);
    expect(out).toMatchObject({
      currency: 'SDG', receiptPrefix: 'SCH-REC-', voucherPrefix: 'SCH-EXP-', graceDays: 7,
    });
  });

  it('writes currency and merges the finance bag without clobbering other keys', async () => {
    const tx = txBase({
      tenant: {
        findUnique: jest.fn(async () => ({ id: TENANT, currencyCode: 'SDG', settings: { other: { x: 1 } } })),
        update: jest.fn(async (args: any) => ({ id: TENANT, ...args.data })),
      },
    });
    await harness(tx).updateFinanceSettings(TENANT, { currency: 'USD', receiptPrefix: 'R-', graceDays: 3 });
    const data = (tx.tenant.update as jest.Mock).mock.calls[0][0].data;
    expect(data.currencyCode).toBe('USD');
    expect(data.settings).toMatchObject({ other: { x: 1 }, finance: { receiptPrefix: 'R-', graceDays: 3 } });
  });

  it('400s a bad currency code or negative grace days', async () => {
    const svc = harness(txBase());
    await expect(svc.updateFinanceSettings(TENANT, { currency: 'SD' })).rejects.toThrow();
    await expect(svc.updateFinanceSettings(TENANT, { graceDays: -1 })).rejects.toThrow();
  });
});
