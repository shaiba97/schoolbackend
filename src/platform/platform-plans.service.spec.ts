import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

import { PlatformPlansService, type PlanActor } from './platform-plans.service';

const actor: PlanActor = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'user-platform-1',
  role: 'SUPER_ADMIN',
};

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const LICENSE_ID = '33333333-3333-4333-8333-333333333333';

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    platformPlan: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: PLAN_ID, code: 'TIER-X' }),
      update: jest.fn().mockResolvedValue({ id: PLAN_ID, code: 'TIER-X' }),
      delete: jest.fn().mockResolvedValue({ id: PLAN_ID, code: 'TIER-X' }),
    },
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: TENANT_ID, status: 'ACTIVE' }),
    },
    tenantLicense: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: LICENSE_ID, status: 'ACTIVE' }),
      create: jest.fn().mockResolvedValue({ id: LICENSE_ID }),
      count: jest.fn().mockResolvedValue(0),
    },
    tenantModule: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({ id: 'module-1' }),
    },
    platformAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    ...overrides,
  } as unknown as PrismaService;

  return { service: new PlatformPlansService(prisma), prisma };
}

describe('PlatformPlansService.listTiers', () => {
  it('returns every tier with its entitlements', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findMany as jest.Mock).mockResolvedValue([
      {
        id: PLAN_ID,
        code: 'PRIMARY',
        name: 'Primary Plan',
        tier: 'PRIMARY',
        target: 'Small schools.',
        billingModel: 'ANNUAL',
        price: 800,
        priceMax: null,
        currency: 'USD',
        durationDays: 365,
        sortOrder: 1,
        includedModules: ['ADMIN', 'ACADEMIC'],
        features: { reportCards: true },
        isActive: true,
      },
    ]);

    const tiers = await service.listTiers();

    expect(tiers[0]).toMatchObject({ code: 'PRIMARY', price: 800, durationDays: 365 });
    expect(tiers[0].includedModules).toEqual(['ADMIN', 'ACADEMIC']);
  });
});

describe('PlatformPlansService.createTier', () => {
  it('creates a tier with its portals and features', async () => {
    const { service, prisma } = build();

    await service.createTier(
      {
        code: 'TIER-X',
        name: 'Tier X',
        tier: 'CUSTOM',
        target: 'Groups.',
        billingModel: 'ANNUAL',
        price: 2000,
        currency: 'USD',
        durationDays: 180,
        includedModules: ['ADMIN'],
        features: { dedicatedSla: true },
      },
      actor,
    );

    expect(prisma.platformPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'TIER-X',
          tier: 'CUSTOM',
          durationDays: 180,
          includedModules: ['ADMIN'],
        }),
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'platform.tier.created' }),
      }),
    );
  });

  it('refuses a code that is already taken', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({ id: PLAN_ID });

    await expect(
      service.createTier(
        {
          code: 'PRIMARY',
          name: 'Primary',
          tier: 'PRIMARY',
          billingModel: 'ANNUAL',
          price: 1,
          currency: 'USD',
          durationDays: 365,
          includedModules: [],
          features: {},
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a code that is not a clean identifier', async () => {
    const { service } = build();

    await expect(
      service.createTier(
        {
          code: 'lower case!',
          name: 'Bad',
          tier: 'CUSTOM',
          billingModel: 'ANNUAL',
          price: 1,
          currency: 'USD',
          durationDays: 365,
          includedModules: [],
          features: {},
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a tier that never ends', async () => {
    const { service } = build();

    await expect(
      service.createTier(
        {
          code: 'FOREVER',
          name: 'Forever',
          tier: 'CUSTOM',
          billingModel: 'LIFETIME' as never,
          price: 1,
          currency: 'USD',
          durationDays: 365,
          includedModules: [],
          features: {},
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PlatformPlansService.updateTier', () => {
  it('changes the price, limits, and portals of a tier', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({ id: PLAN_ID, price: 800 });

    await service.updateTier(
      PLAN_ID,
      { price: 950, durationDays: 730, includedModules: ['ADMIN', 'FINANCIAL'] },
      actor,
    );

    expect(prisma.platformPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PLAN_ID },
        data: expect.objectContaining({
          price: 950,
          durationDays: 730,
          includedModules: ['ADMIN', 'FINANCIAL'],
        }),
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'platform.tier.updated' }),
      }),
    );
  });

  it('refuses an unknown tier', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.updateTier(PLAN_ID, { price: 10 }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PlatformPlansService.deleteTier', () => {
  it('deletes a tier that no school holds', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'TIER-X',
      name: 'Tier X',
      price: 100,
      currency: 'USD',
      durationDays: 365,
    });
    (prisma.tenantLicense.count as jest.Mock).mockResolvedValue(0);

    const result = await service.deleteTier(PLAN_ID, actor);

    expect(result).toMatchObject({ id: PLAN_ID, code: 'TIER-X', deleted: true });
    expect(prisma.platformPlan.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PLAN_ID } }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'platform.tier.deleted' }),
      }),
    );
  });

  it('refuses to delete a tier that licences still point at', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'TIER-X',
      name: 'Tier X',
    });
    (prisma.tenantLicense.count as jest.Mock).mockResolvedValue(2);

    await expect(service.deleteTier(PLAN_ID, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.platformPlan.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete an unknown tier', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.deleteTier(PLAN_ID, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PlatformPlansService.subscriptions', () => {
  it('reports days remaining and flags a licence that is about to expire', async () => {
    const { service, prisma } = build();
    const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      {
        id: TENANT_ID,
        name: 'Springfield Academy',
        slug: 'springfield',
        countryCode: 'SD',
        currencyCode: 'SDG',
        status: 'ACTIVE',
        logoUrl: null,
        lockedAt: null,
        lockReason: null,
        licenses: [
          {
            id: LICENSE_ID,
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01'),
            expiresAt: inTenDays,
            terminatedAt: null,
            plan: { id: PLAN_ID, code: 'PRIMARY', name: 'Primary Plan', price: 800, currency: 'USD' },
          },
        ],
      },
    ]);

    const rows = await service.subscriptions();

    expect(rows[0]).toMatchObject({
      tenantId: TENANT_ID,
      tier: 'PRIMARY',
      status: 'EXPIRING_SOON',
      lockStatus: 'ACTIVE',
    });
    expect(rows[0].daysRemaining).toBeGreaterThanOrEqual(9);
    expect(rows[0].daysRemaining).toBeLessThanOrEqual(10);
  });

  it('reports a terminated school as locked', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      {
        id: TENANT_ID,
        name: 'Springfield Academy',
        slug: 'springfield',
        countryCode: 'SD',
        currencyCode: 'SDG',
        status: 'SUSPENDED',
        logoUrl: null,
        lockedAt: new Date('2026-04-01'),
        lockReason: 'LICENSE_EXPIRED',
        licenses: [
          {
            id: LICENSE_ID,
            status: 'EXPIRED',
            startedAt: new Date('2026-01-01'),
            expiresAt: new Date('2026-03-31'),
            terminatedAt: new Date('2026-04-01'),
            plan: { id: PLAN_ID, code: 'PRIMARY', name: 'Primary Plan', price: 800, currency: 'USD' },
          },
        ],
      },
    ]);

    const rows = await service.subscriptions();

    expect(rows[0].status).toBe('EXPIRED');
    expect(rows[0].lockStatus).toBe('TERMINATED');
    expect(rows[0].lockReason).toBe('LICENSE_EXPIRED');
  });

  it('reports the licensed students and the monthly amount', async () => {    const { service, prisma } = build();
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      {
        id: TENANT_ID,
        name: 'Springfield Academy',
        slug: 'springfield',
        countryCode: 'SA',
        currencyCode: 'SAR',
        status: 'ACTIVE',
        logoUrl: null,
        lockedAt: null,
        lockReason: null,
        licenses: [
          {
            id: LICENSE_ID,
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01'),
            expiresAt: new Date('2026-12-31'),
            terminatedAt: null,
            seats: 400,
            plan: {
              id: PLAN_ID,
              code: 'PRIMARY',
              name: 'Primary Plan',
              tier: 'PRIMARY',
              price: 800,
              currency: 'USD',
              durationDays: 365,
            },
          },
        ],
      },
    ]);

    const rows = await service.subscriptions();

    expect(rows[0].studentCount).toBe(400);
    // The stored price is the yearly amount: 800 a year is 66.67 a month.
    expect(rows[0].yearlyPrice).toBe(800);
    expect(rows[0].monthlyPrice).toBe(66.67);
    expect(rows[0].monthlyUsd).toBe(66.67);
  });
  it('reports a subscription with no licence as having no students', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      {
        id: TENANT_ID,
        name: 'Springfield Academy',
        slug: 'springfield',
        countryCode: 'SA',
        currencyCode: 'SAR',
        status: 'ACTIVE',
        logoUrl: null,
        lockedAt: null,
        lockReason: null,
        licenses: [],
      },
    ]);

    const rows = await service.subscriptions();

    expect(rows[0].status).toBe('NO_LICENSE');
    expect(rows[0].studentCount).toBe(0);
    expect(rows[0].monthlyUsd).toBe(0);
  });

  it('bills the rate the licence carries, not the tier list price', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      {
        id: TENANT_ID,
        name: 'Springfield Academy',
        slug: 'springfield',
        countryCode: 'SA',
        currencyCode: 'SAR',
        status: 'ACTIVE',
        logoUrl: null,
        lockedAt: null,
        lockReason: null,
        licenses: [
          {
            id: LICENSE_ID,
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01'),
            expiresAt: new Date('2026-12-31'),
            terminatedAt: null,
            seats: 100,
            yearlyPrice: 950,
            plan: {
              id: PLAN_ID,
              code: 'CUSTOM',
              name: 'Customized Plan',
              tier: 'CUSTOM',
              price: 0,
              currency: 'USD',
              durationDays: 365,
            },
          },
        ],
      },
    ]);

    const rows = await service.subscriptions();

    expect(rows[0].yearlyPrice).toBe(950);
    expect(rows[0].monthlyPrice).toBe(79.17);
    expect(rows[0].monthlyUsd).toBe(79.17);
  });
});

describe('PlatformPlansService.renew', () => {
  it('extends the term and unlocks a school whose licence had expired', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'SUSPENDED',
      lockedAt: new Date('2026-04-01'),
      lockReason: 'LICENSE_EXPIRED',
      licenses: [
        {
          id: LICENSE_ID,
          status: 'EXPIRED',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-03-31'),
          terminatedAt: new Date('2026-04-01'),
          plan: { id: PLAN_ID, code: 'PRIMARY', durationDays: 365 },
        },
      ],
    });

    const result = await service.renew(TENANT_ID, {}, actor);

    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ID },
        data: expect.objectContaining({
          status: 'ACTIVE',
          terminatedAt: null,
          terminationReason: null,
        }),
      }),
    );
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_ID },
        data: expect.objectContaining({ status: 'ACTIVE', lockedAt: null, lockReason: null }),
      }),
    );
    expect(result.status).toBe('ACTIVE');
  });

  it('uses the tier term when no end date is given', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          yearlyPrice: null,
          plan: { id: PLAN_ID, code: 'PRIMARY', price: 800, durationDays: 90 },
        },
      ],
    });

    await service.renew(TENANT_ID, {}, actor);

    const call = (prisma.tenantLicense.update as jest.Mock).mock.calls[0][0];
    const expiresAt = call.data.expiresAt as Date;
    const days = Math.round((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    expect(days).toBeGreaterThanOrEqual(89);
    expect(days).toBeLessThanOrEqual(90);
  });

  it('runs the term for as many years as were asked for', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          yearlyPrice: null,
          plan: { id: PLAN_ID, code: 'PRIMARY', price: 800, durationDays: 365 },
        },
      ],
    });

    const result = await service.renew(TENANT_ID, { years: 3 }, actor);

    const call = (prisma.tenantLicense.update as jest.Mock).mock.calls[0][0];
    const expiresAt = call.data.expiresAt as Date;
    const days = Math.round((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    expect(days).toBeGreaterThanOrEqual(1094);
    expect(days).toBeLessThanOrEqual(1096);
    // 800 a year for three years is 2,400 due, at 66.67 a month.
    expect(result.years).toBe(3);
    expect(result.termTotal).toBe(2400);
    expect(result.monthlyPrice).toBe(66.67);
  });

  it('refuses a term shorter than a year', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          yearlyPrice: null,
          plan: { id: PLAN_ID, code: 'PRIMARY', price: 800, durationDays: 365 },
        },
      ],
    });

    await expect(service.renew(TENANT_ID, { years: 0 }, actor)).rejects.toThrow(
      'The minimum subscription is one year.',
    );
    expect(prisma.tenantLicense.update).not.toHaveBeenCalled();
  });

  it('can carry a quoted yearly rate into the renewal', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          yearlyPrice: null,
          plan: { id: PLAN_ID, code: 'CUSTOM', price: 0, durationDays: 365 },
        },
      ],
    });

    await service.renew(TENANT_ID, { yearlyPrice: 725 }, actor);

    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ID },
        data: expect.objectContaining({ yearlyPrice: 725 }),
      }),
    );
  });

  it('refuses to renew a school with no licence', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      licenses: [],
    });

    await expect(service.renew(TENANT_ID, {}, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('can carry a new licensed student count into the renewal', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          plan: { id: PLAN_ID, code: 'PRIMARY', durationDays: 365 },
        },
      ],
    });

    await service.renew(TENANT_ID, { studentCount: 250 }, actor);

    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ID },
        data: expect.objectContaining({ seats: 250, status: 'ACTIVE' }),
      }),
    );
  });
});

describe('PlatformPlansService.terminate', () => {
  it('ends the licence and locks the school', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          plan: { id: PLAN_ID, code: 'PRIMARY', durationDays: 365 },
        },
      ],
    });

    await service.terminate(TENANT_ID, actor);

    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ID },
        data: expect.objectContaining({
          status: 'SUSPENDED',
          terminationReason: 'MANUAL_TERMINATION',
        }),
      }),
    );
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_ID },
        data: expect.objectContaining({
          status: 'SUSPENDED',
          lockReason: 'MANUAL_TERMINATION',
        }),
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'platform.subscription.terminated' }),
      }),
    );
  });
});

describe('PlatformPlansService.upgrade', () => {
  it('moves the licence to the new tier and syncs the portals', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'ADVANCED',
      includedModules: ['ADMIN', 'FINANCIAL'],
      price: 3600,
    });
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          plan: { id: 'old-plan', code: 'PRIMARY', durationDays: 365 },
        },
      ],
    });

    await service.upgrade(TENANT_ID, { planId: PLAN_ID }, actor);

    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ID },
        data: expect.objectContaining({ planId: PLAN_ID }),
      }),
    );
    expect(prisma.tenantModule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_module: { tenantId: TENANT_ID, module: 'FINANCIAL' } },
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'platform.subscription.upgraded' }),
      }),
    );
  });

  it('refuses an unknown plan', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.upgrade(TENANT_ID, { planId: PLAN_ID }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('prices an upgrade to a list-priced tier at the tier list price', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'ADVANCED',
      includedModules: ['ADMIN'],
      durationDays: 365,
      price: 3600,
    });
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          yearlyPrice: 800,
          plan: { id: 'old-plan', code: 'PRIMARY', durationDays: 365 },
        },
      ],
    });

    await service.upgrade(TENANT_ID, { planId: PLAN_ID }, actor);

    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ID },
        data: expect.objectContaining({ yearlyPrice: 3600 }),
      }),
    );
  });

  it('carries the agreed yearly rate when the target tier has no list price', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'CUSTOM',
      includedModules: ['ADMIN'],
      durationDays: 365,
      price: 0,
    });
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          yearlyPrice: 2600,
          plan: { id: 'old-plan', code: 'INTERMEDIATE', durationDays: 365 },
        },
      ],
    });

    await service.upgrade(TENANT_ID, { planId: PLAN_ID }, actor);

    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ID },
        data: expect.objectContaining({ yearlyPrice: 2600 }),
      }),
    );
  });

  it('takes the tier list price even when the licence carried a higher negotiated rate', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'ADVANCED',
      includedModules: ['ADMIN'],
      durationDays: 365,
      price: 3600,
    });
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          yearlyPrice: 5000,
          plan: { id: 'old-plan', code: 'INTERMEDIATE', durationDays: 365 },
        },
      ],
    });

    await service.upgrade(TENANT_ID, { planId: PLAN_ID }, actor);

    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ID },
        data: expect.objectContaining({ yearlyPrice: 3600 }),
      }),
    );
  });

  it('lets an operator-entered price override the tier list price', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'ADVANCED',
      includedModules: ['ADMIN'],
      durationDays: 365,
      price: 3600,
    });
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          yearlyPrice: 800,
          plan: { id: 'old-plan', code: 'PRIMARY', durationDays: 365 },
        },
      ],
    });

    const result = await service.upgrade(
      TENANT_ID,
      { planId: PLAN_ID, years: 2, yearlyPrice: 4200 },
      actor,
    );

    expect(result.yearlyPrice).toBe(4200);
    expect(result.termTotal).toBe(8400);
    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ID },
        data: expect.objectContaining({ yearlyPrice: 4200 }),
      }),
    );
  });

  it('keeps the agreed rate when an expired licence takes the same tier again', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'CUSTOM',
      includedModules: ['ADMIN'],
      durationDays: 365,
      price: 0,
    });
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'SUSPENDED',
      lockedAt: new Date('2026-04-01'),
      lockReason: 'LICENSE_EXPIRED',
      licenses: [
        {
          id: LICENSE_ID,
          status: 'EXPIRED',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-03-31'),
          terminatedAt: new Date('2026-04-01'),
          yearlyPrice: 4200,
          plan: { id: PLAN_ID, code: 'CUSTOM', durationDays: 365 },
        },
      ],
    });

    await service.upgrade(TENANT_ID, { planId: PLAN_ID }, actor);

    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LICENSE_ID },
        data: expect.objectContaining({ yearlyPrice: 4200 }),
      }),
    );
  });

  it('refuses a quoted tier with no agreed rate instead of writing a zero licence', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'CUSTOM',
      includedModules: ['ADMIN'],
      durationDays: 365,
      price: 0,
    });
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-12-31'),
          terminatedAt: null,
          yearlyPrice: null,
          plan: { id: 'old-plan', code: 'LEGACY', durationDays: 0 },
        },
      ],
    });

    await expect(
      service.upgrade(TENANT_ID, { planId: PLAN_ID }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tenantLicense.update).not.toHaveBeenCalled();
  });

  it('starts the new tier term when a school moves off a lifetime plan', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'ADVANCED',
      includedModules: ['ADMIN'],
      durationDays: 365,
      price: 3600,
    });
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      lockedAt: null,
      lockReason: null,
      licenses: [
        {
          id: LICENSE_ID,
          status: 'ACTIVE',
          startedAt: new Date('2026-01-01'),
          expiresAt: null,
          terminatedAt: null,
          plan: { id: 'legacy-plan', code: 'LEGACY', durationDays: 0 },
        },
      ],
    });

    await service.upgrade(TENANT_ID, { planId: PLAN_ID }, actor);

    const call = (prisma.tenantLicense.update as jest.Mock).mock.calls[0][0];
    const expiresAt = call.data.expiresAt as Date;
    const days = Math.round((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    expect(days).toBeGreaterThanOrEqual(364);
    expect(days).toBeLessThanOrEqual(365);
  });

  it('unlocks a school whose term ended when it moves to a new tier', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue({
      id: PLAN_ID,
      code: 'ADVANCED',
      includedModules: ['ADMIN'],
      durationDays: 365,
      price: 3600,
    });
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'SUSPENDED',
      lockedAt: new Date('2026-04-01'),
      lockReason: 'LICENSE_EXPIRED',
      licenses: [
        {
          id: LICENSE_ID,
          status: 'EXPIRED',
          startedAt: new Date('2026-01-01'),
          expiresAt: new Date('2026-03-31'),
          terminatedAt: new Date('2026-04-01'),
          plan: { id: 'legacy-plan', code: 'LEGACY', durationDays: 0 },
        },
      ],
    });

    await service.upgrade(TENANT_ID, { planId: PLAN_ID }, actor);

    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_ID },
        data: expect.objectContaining({
          status: 'ACTIVE',
          lockedAt: null,
          lockReason: null,
        }),
      }),
    );
  });
});

describe('PlatformPlansService.publicPricingTiers', () => {
  function pricingRow(overrides: Record<string, unknown> = {}) {
    return {
      id: PLAN_ID,
      code: 'PRIMARY',
      name: 'Primary Plan',
      tier: 'PRIMARY',
      target: 'Small schools.',
      billingModel: 'ANNUAL',
      price: 800,
      priceMax: null,
      currency: 'USD',
      durationDays: 365,
      sortOrder: 1,
      includedModules: ['ADMIN', 'ACADEMIC'],
      features: { reportCards: true },
      isActive: true,
      ...overrides,
    };
  }

  it('lists active, tiered rows only and labels the checklist', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findMany as jest.Mock).mockResolvedValue([
      pricingRow(),
      pricingRow({
        code: 'LEGACY-ROW',
        name: 'Legacy Plan',
        tier: null,
      }),
      pricingRow({ code: 'OLD-TIER', name: 'Retired Tier', isActive: false }),
    ]);

    const tiers = await service.publicPricingTiers();

    expect(tiers).toHaveLength(1);
    expect(tiers[0].code).toBe('PRIMARY');
    expect(tiers[0].monthlyPrice).toBeCloseTo(66.67, 2);
    expect(tiers[0].isQuoteBased).toBe(false);

    const modules = tiers[0].checklist.filter((item) => item.kind === 'module');
    const unlocked = modules.filter((item) => item.unlocked).map((item) => item.label);
    const locked = modules.filter((item) => !item.unlocked).map((item) => item.label);
    expect(unlocked).toEqual(['Central Admin Portal', 'Academic & Examination Center']);
    expect(locked).toContain('Financial & Student Payments');
    expect(modules.map((item) => item.label)).toContain('Transport & Fleet Management');

    const reportCards = tiers[0].checklist.find(
      (item) => item.label === 'Basic report cards',
    );
    expect(reportCards).toMatchObject({ kind: 'feature', unlocked: true });
    expect(
      tiers[0].checklist.some((item) => item.kind === 'feature' && !item.unlocked),
    ).toBe(false);
  });

  it('flags quote-based tiers', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findMany as jest.Mock).mockResolvedValue([
      pricingRow({
        code: 'CUSTOM',
        name: 'Customized Plan',
        tier: 'CUSTOM',
        price: 0,
        target: 'School groups.',
        includedModules: [],
        features: { dedicatedSla: true },
      }),
    ]);

    const tiers = await service.publicPricingTiers();

    expect(tiers[0].isQuoteBased).toBe(true);
    expect(tiers[0].monthlyPrice).toBe(0);
    const dedicatedSla = tiers[0].checklist.find(
      (item) => item.label === 'Dedicated SLA',
    );
    expect(dedicatedSla).toMatchObject({ kind: 'feature', unlocked: true });
  });
});
