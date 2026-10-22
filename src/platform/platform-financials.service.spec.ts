import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

import {
  PlatformFinancialsService,
  type PlatformActor,
} from './platform-financials.service';

const actor: PlatformActor = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'user-platform-1',
  role: 'SUPER_ADMIN',
};

const RATES = [
  {
    code: 'USD',
    name: 'US Dollar',
    countryCode: null,
    rateToUsd: 1,
    autoSync: true,
    lastSyncedAt: null,
  },
  {
    code: 'SAR',
    name: 'Saudi Riyal',
    countryCode: 'SA',
    rateToUsd: 3.75,
    autoSync: true,
    lastSyncedAt: null,
  },
  {
    code: 'SDG',
    name: 'Sudanese Pound',
    countryCode: 'SD',
    rateToUsd: 1305,
    autoSync: false,
    lastSyncedAt: null,
  },
];

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    platformCurrency: {
      findMany: jest.fn().mockResolvedValue(RATES),
      findUnique: jest.fn().mockResolvedValue(RATES[1]),
      update: jest
        .fn()
        .mockImplementation(
          async ({
            where,
            data,
          }: {
            where: { code: string };
            data: Record<string, unknown>;
          }) => ({
            ...RATES[1],
            code: where.code,
            rateToUsd: data.rateToUsd ?? RATES[1].rateToUsd,
            autoSync: (data.autoSync as boolean) ?? RATES[1].autoSync,
            lastSyncedAt: (data.lastSyncedAt as Date) ?? RATES[1].lastSyncedAt,
          }),
        ),
    },
    platformPayment: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
    },
    platformExpense: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      create: jest.fn().mockResolvedValue({ id: 'expense-1' }),
    },
    platformInvoice: {
      count: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'invoice-1', number: 'PLT-2026-0001' }),
    },
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    tenantLicense: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    platformAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    ...overrides,
  } as unknown as PrismaService;

  return { service: new PlatformFinancialsService(prisma), prisma };
}

describe('PlatformFinancialsService.overview', () => {
  it('converts cash received into USD and subtracts expenses', async () => {
    const { service, prisma } = build();
    // 3,750 SAR received = 1,000 USD.
    (prisma.platformPayment.findMany as jest.Mock).mockResolvedValue([
      { amount: 3750, currency: 'SAR', paidAt: new Date('2026-03-01') },
    ]);
    // 500 USD of infrastructure.
    (prisma.platformExpense.findMany as jest.Mock).mockResolvedValue([
      {
        amount: 500,
        currency: 'USD',
        countryCode: null,
        category: 'INFRASTRUCTURE',
      },
    ]);

    const overview = await service.overview();

    expect(overview.totals.revenue).toBe(1000);
    expect(overview.totals.expenses).toBe(500);
    expect(overview.totals.netProfit).toBe(500);
    expect(overview.totals.marginPct).toBe(50);
  });

  it('leaves a negative margin when expenses exceed revenue', async () => {
    const { service, prisma } = build();
    (prisma.platformPayment.findMany as jest.Mock).mockResolvedValue([
      { amount: 100, currency: 'USD', paidAt: new Date('2026-03-01') },
    ]);
    (prisma.platformExpense.findMany as jest.Mock).mockResolvedValue([
      { amount: 250, currency: 'USD', countryCode: null, category: 'LEGAL' },
    ]);

    const overview = await service.overview();

    expect(overview.totals.netProfit).toBe(-150);
    expect(overview.totals.marginPct).toBe(-150);
  });

  it('breaks income and expenses down per country', async () => {
    const { service, prisma } = build();
    (prisma.platformPayment.findMany as jest.Mock).mockResolvedValue([
      { amount: 3750, currency: 'SAR', paidAt: new Date('2026-03-01') },
      { amount: 1305, currency: 'SDG', paidAt: new Date('2026-03-02') },
    ]);
    (prisma.platformExpense.findMany as jest.Mock).mockResolvedValue([
      {
        amount: 100,
        currency: 'SAR',
        countryCode: 'SA',
        category: 'INFRASTRUCTURE',
      },
      { amount: 50, currency: 'USD', countryCode: null, category: 'MARKETING' },
    ]);

    const overview = await service.overview();

    const saudi = overview.countries.find((row) => row.countryCode === 'SA');
    expect(saudi?.localIncome).toBe(3750);
    expect(saudi?.localExpenses).toBe(100);
    // 3,650 SAR net = 973.33 USD.
    expect(saudi?.netProfitUsd).toBeCloseTo(973.33, 2);

    const sudan = overview.countries.find((row) => row.countryCode === 'SD');
    expect(sudan?.localIncome).toBe(1305);
    expect(sudan?.localExpenses).toBe(0);
    expect(sudan?.netProfitUsd).toBe(1);
  });

  it('never counts a global expense against a country', async () => {
    const { service, prisma } = build();
    (prisma.platformExpense.findMany as jest.Mock).mockResolvedValue([
      {
        amount: 900,
        currency: 'USD',
        countryCode: null,
        category: 'INFRASTRUCTURE',
      },
    ]);

    const overview = await service.overview();

    expect(overview.countries.every((row) => row.localExpenses === 0)).toBe(
      true,
    );
    expect(overview.totals.expenses).toBe(900);
  });
});

describe('PlatformFinancialsService.subscriptions', () => {
  it('prices a school in its own currency and in USD', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'tenant-1',
        name: 'Riyadh International School',
        slug: 'riyadh-international',
        countryCode: 'SA',
        currencyCode: 'SAR',
        status: 'ACTIVE',
        logoUrl: null,
        licenses: [
          {
            id: 'lic-1',
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01'),
            expiresAt: new Date('2026-12-31'),
            plan: {
              code: 'ADVANCED',
              name: 'Advanced Plan',
              price: 3500,
              currency: 'USD',
            },
            payments: [],
          },
        ],
      },
    ]);

    const rows = await service.subscriptions();

    expect(rows[0]).toMatchObject({
      tenantId: 'tenant-1',
      name: 'Riyadh International School',
      tier: 'ADVANCED',
      currency: 'SAR',
      status: 'OVERDUE',
    });
    // 3,600 USD a year is 300 a month, and 3.75 SAR to the dollar.
    expect(rows[0].yearlyPrice).toBe(3500);
    expect(rows[0].monthlyPrice).toBe(291.67);
    expect(rows[0].priceUsd).toBe(291.67);
    expect(rows[0].localPrice).toBe(1093.76);
  });

  it('refuses to invent a price for a school in a currency with no rate', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'tenant-eur',
        name: 'Euro School',
        slug: 'euro-school',
        countryCode: null,
        currencyCode: 'EUR',
        status: 'ACTIVE',
        logoUrl: null,
        licenses: [
          {
            id: 'lic-eur',
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01'),
            expiresAt: new Date('2026-12-31'),
            plan: {
              code: 'ADVANCED',
              name: 'Advanced Plan',
              price: 3500,
              currency: 'USD',
            },
            payments: [],
          },
        ],
      },
    ]);

    const rows = await service.subscriptions();

    expect(rows[0].status).toBe('UNPRICED');
    expect(rows[0].currencyConfigured).toBe(false);
    expect(rows[0].localPrice).toBeNull();
    // The USD list price is still known.
    expect(rows[0].priceUsd).toBe(291.67);
  });

  it('marks a subscription PARTIAL when part of it is paid and PAID when it is covered', async () => {
    const { service, prisma } = build();
    const base = {
      id: 'tenant-1',
      name: 'Riyadh International School',
      slug: 'riyadh',
      countryCode: 'SA',
      currencyCode: 'SAR',
      status: 'ACTIVE',
      logoUrl: null,
    };
    const plan = {
      code: 'ADVANCED',
      name: 'Advanced Plan',
      price: 3500,
      currency: 'USD',
    };
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      {
        ...base,
        licenses: [
          {
            id: 'lic-1',
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01'),
            expiresAt: new Date('2026-12-31'),
            plan,
            payments: [
              {
                id: 'p1',
                amount: 1000,
                currency: 'SAR',
                type: 'MANUAL_TRANSFER',
              },
            ],
          },
        ],
      },
    ]);

    const partial = await service.subscriptions();
    expect(partial[0].status).toBe('PARTIAL');
    expect(partial[0].paidAmount).toBe(1000);
    expect(partial[0].paymentType).toBe('MANUAL_TRANSFER');

    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      {
        ...base,
        licenses: [
          {
            id: 'lic-1',
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01'),
            expiresAt: new Date('2026-12-31'),
            plan,
            payments: [
              {
                id: 'p1',
                // One term of 3,500 USD at 3.75 SAR per dollar.
                amount: 13125,
                currency: 'SAR',
                type: 'CASH_DEPOSIT',
              },
            ],
          },
        ],
      },
    ]);

    const paid = await service.subscriptions();
    expect(paid[0].status).toBe('PAID');
  });
});

describe('PlatformFinancialsService.updateCurrency', () => {
  it('stores a new rate, reports it as updated, and audits the change', async () => {
    const { service, prisma } = build();

    const result = await service.updateCurrency(
      'SAR',
      { rateToUsd: 3.8 },
      actor,
    );

    expect(prisma.platformCurrency.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'SAR' },
        data: expect.objectContaining({
          rateToUsd: 3.8,
          lastSyncedAt: expect.any(Date),
        }),
      }),
    );
    expect(result.rateToUsd).toBe(3.8);
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'platform.currency.updated',
          newValues: expect.objectContaining({
            code: 'SAR',
            rateToUsd: 3.8,
            previousRateToUsd: 3.75,
          }),
        }),
      }),
    );
  });

  it('refuses a rate that is not positive', async () => {
    const { service } = build();

    await expect(
      service.updateCurrency('SAR', { rateToUsd: 0 }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an unknown currency', async () => {
    const { service, prisma } = build();
    (prisma.platformCurrency.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.updateCurrency('XXX', { rateToUsd: 2 }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlatformFinancialsService.recordPayment', () => {
  it('records the payment against the school and audits it', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: 'tenant-1',
      name: 'Riyadh International School',
      currencyCode: 'SAR',
      licenses: [
        {
          id: 'lic-1',
          status: 'ACTIVE',
          plan: { code: 'ADVANCED', price: 3500, currency: 'USD' },
        },
      ],
    });

    await service.recordPayment(
      {
        tenantId: 'tenant-1',
        licenseId: 'lic-1',
        amount: 5000,
        currency: 'SAR',
        method: 'BANK_TRANSFER',
        paidAt: new Date('2026-04-02'),
        reference: 'TRF-9912',
      },
      actor,
    );

    expect(prisma.platformPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          licenseId: 'lic-1',
          amount: 5000,
          currency: 'SAR',
          method: 'BANK_TRANSFER',
          recordedById: actor.id,
        }),
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'platform.payment.recorded' }),
      }),
    );
  });

  it('refuses a payment for a school that does not exist', async () => {
    const { service } = build();

    await expect(
      service.recordPayment(
        {
          tenantId: 'missing',
          amount: 100,
          currency: 'SAR',
          method: 'CASH',
          paidAt: new Date(),
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlatformFinancialsService.issueReceipt', () => {
  const licence = {
    id: 'lic-1',
    startedAt: new Date('2026-01-01'),
    expiresAt: new Date('2027-12-31'),
    yearlyPrice: 800,
    plan: { price: 800, durationDays: 365, currency: 'USD' },
  };

  it('prices the receipt from the term the school bought', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: 'tenant-1',
      name: 'Riyadh International School',
      licenses: [licence],
    });

    await service.issueReceipt({ tenantId: 'tenant-1' }, actor);

    // Two years at 800 a year is 1,600 due.
    expect(prisma.platformInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          licenseId: 'lic-1',
          amount: 1600,
          currency: 'USD',
          status: 'PAID',
        }),
      }),
    );
  });

  it('prices a quoted licence at the rate it carries', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: 'tenant-1',
      name: 'Riyadh International School',
      licenses: [
        {
          ...licence,
          yearlyPrice: 950,
          plan: { price: 0, durationDays: 365, currency: 'USD' },
        },
      ],
    });

    await service.issueReceipt({ tenantId: 'tenant-1' }, actor);

    expect(prisma.platformInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 1900 }),
      }),
    );
  });

  it('records a part payment when the caller states the amount', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: 'tenant-1',
      name: 'Riyadh International School',
      licenses: [licence],
    });

    await service.issueReceipt(
      { tenantId: 'tenant-1', amount: 400, currency: 'SAR' },
      actor,
    );

    expect(prisma.platformInvoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 400, currency: 'SAR' }),
      }),
    );
  });
});

describe('PlatformFinancialsService.logExpense', () => {
  it('records the expense and audits it', async () => {
    const { service, prisma } = build();

    await service.logExpense(
      {
        title: 'AWS Server Hosting',
        category: 'INFRASTRUCTURE',
        countryCode: null,
        amount: 420,
        currency: 'USD',
        paidAt: new Date('2026-04-01'),
      },
      actor,
    );

    expect(prisma.platformExpense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'AWS Server Hosting',
          category: 'INFRASTRUCTURE',
          countryCode: null,
          amount: 420,
          recordedById: actor.id,
        }),
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'platform.expense.logged' }),
      }),
    );
  });
});
