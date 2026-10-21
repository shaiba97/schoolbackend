import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

import {
  PlatformTenantsService,
  type PlatformActor,
} from './platform-tenants.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const actor: PlatformActor = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'user-platform-1',
  role: 'SUPER_ADMIN',
  ip: '10.0.0.1',
  userAgent: 'jest',
};

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    tenant: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'ACTIVE', _count: { _all: 3 } },
        { status: 'SUSPENDED', _count: { _all: 1 } },
      ]),
      count: jest.fn().mockResolvedValue(4),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: TENANT_ID, status: 'SUSPENDED' }),
    },
    tenantLicense: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    platformInvoice: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tenantModule: {
      upsert: jest.fn().mockResolvedValue({ id: 'module-1', enabled: true }),
    },
    tenantFeatureFlag: {
      upsert: jest.fn().mockResolvedValue({ id: 'flag-1', enabled: true }),
    },
    platformAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as unknown as PrismaService;

  return { service: new PlatformTenantsService(prisma), prisma };
}

describe('PlatformTenantsService.stats', () => {
  it('counts schools by status and totals the platform', async () => {
    const { service } = build();

    const stats = await service.stats();

    expect(stats.tenants.total).toBe(4);
    expect(stats.tenants.ACTIVE).toBe(3);
    expect(stats.tenants.SUSPENDED).toBe(1);
    expect(stats.tenants.TRIAL).toBe(0);
  });

  it('computes MRR from active annual licenses only (price / 12)', async () => {
    const { service, prisma } = build();
    (prisma.tenantLicense.findMany as jest.Mock).mockResolvedValue([
      { id: 'l1', plan: { code: 'PRO', billingModel: 'ANNUAL', price: 1200 } },
      { id: 'l2', plan: { code: 'LITE', billingModel: 'ANNUAL', price: 300 } },
    ]);

    const stats = await service.stats();

    expect(stats.licensing.mrr).toBe(125);
    expect(prisma.tenantLicense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('ignores lifetime licenses in MRR', async () => {
    const { service, prisma } = build();
    (prisma.tenantLicense.findMany as jest.Mock).mockResolvedValue([
      { id: 'l1', plan: { code: 'PERP', billingModel: 'LIFETIME', price: 5000 } },
    ]);

    const stats = await service.stats();

    expect(stats.licensing.mrr).toBe(0);
  });

  it('reports revenue as the sum of paid invoices and counts due ones', async () => {
    const { service, prisma } = build();
    (prisma.platformInvoice.aggregate as jest.Mock).mockResolvedValue({
      _sum: { amount: 4200 },
    });
    (prisma.platformInvoice.count as jest.Mock).mockResolvedValue(3);

    const stats = await service.stats();

    expect(stats.licensing.revenue).toBe(4200);
    expect(stats.licensing.dueInvoices).toBe(3);
    expect(prisma.platformInvoice.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PAID' },
      }),
    );
  });
});

describe('PlatformTenantsService.list', () => {
  it('filters by search term across name, slug, and email', async () => {
    const { service, prisma } = build();

    await service.list({ search: 'spring', status: 'ACTIVE', page: 1, limit: 20 });

    const args = (prisma.tenant.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where.status).toBe('ACTIVE');
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: expect.objectContaining({ mode: 'insensitive' }) }),
      ]),
    );
  });

  it('paginates with a bounded page size', async () => {
    const { service, prisma } = build();

    await service.list({ page: 3, limit: 10 });

    const args = (prisma.tenant.findMany as jest.Mock).mock.calls[0][0];
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
  });

  it('clamps the page size to 100', async () => {
    const { service, prisma } = build();

    await service.list({ page: 1, limit: 5000 });

    const args = (prisma.tenant.findMany as jest.Mock).mock.calls[0][0];
    expect(args.take).toBe(100);
  });

  it('returns the plan and license of each school with the totals', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      {
        id: TENANT_ID,
        name: 'Springfield Academy',
        slug: 'springfield',
        status: 'ACTIVE',
        countryCode: 'SD',
        currencyCode: 'SDG',
        timezone: 'Africa/Khartoum',
        createdAt: new Date('2026-01-01'),
        licenses: [
          {
            id: 'lic-1',
            status: 'ACTIVE',
            expiresAt: null,
            plan: { code: 'PRO', name: 'Pro', billingModel: 'ANNUAL', price: 1200 },
          },
        ],
        _count: { memberships: 12, modules: 5 },
      },
    ]);
    (prisma.tenant.count as jest.Mock).mockResolvedValue(1);

    const result = await service.list({ page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: TENANT_ID,
      name: 'Springfield Academy',
      status: 'ACTIVE',
      plan: { code: 'PRO', name: 'Pro' },
      users: 12,
      enabledModules: 5,
    });
  });
});

describe('PlatformTenantsService.detail', () => {
  it('throws when the school does not exist', async () => {
    const { service } = build();

    await expect(service.detail(TENANT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the school with its modules, flags, counts, and recent activity', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      name: 'Springfield Academy',
      slug: 'springfield',
      status: 'ACTIVE',
      licenses: [
        {
          id: 'lic-1',
          status: 'ACTIVE',
          expiresAt: null,
          plan: { code: 'PRO', name: 'Pro', billingModel: 'ANNUAL', price: 1200 },
        },
      ],
      modules: [{ id: 'm1', module: 'ADMIN', enabled: true }],
      featureFlags: [{ id: 'f1', key: 'portal.transport.tracking', enabled: true }],
      _count: { memberships: 12, students: 300, teachers: 20 },
    });

    const detail = await service.detail(TENANT_ID);

    expect(detail.modules).toEqual([
      { id: 'm1', module: 'ADMIN', enabled: true },
    ]);
    expect(detail.featureFlags).toEqual([
      { id: 'f1', key: 'portal.transport.tracking', enabled: true },
    ]);
    expect(detail.counts).toEqual({ users: 12, students: 300, teachers: 20 });
    expect(detail.licenses[0]).toMatchObject({ id: 'lic-1', plan: { code: 'PRO' } });
  });
});

describe('PlatformTenantsService.updateStatus', () => {
  it('suspends an active school and records an audit entry', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      status: 'ACTIVE',
    });

    await service.updateStatus(TENANT_ID, 'SUSPENDED', actor);

    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_ID },
        data: { status: 'SUSPENDED' },
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: actor.id,
          action: 'tenant.status.changed',
          entityType: 'tenant',
          entityId: TENANT_ID,
          tenantId: TENANT_ID,
          oldValues: { status: 'ACTIVE' },
          newValues: { status: 'SUSPENDED' },
        }),
      }),
    );
  });

  it('refuses to re-activate an archived school', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      status: 'ARCHIVED',
    });

    await expect(
      service.updateStatus(TENANT_ID, 'ACTIVE', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('treats a no-op status change as a no-op', async () => {
    const { service, prisma } = build();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      id: TENANT_ID,
      status: 'ACTIVE',
    });

    const result = await service.updateStatus(TENANT_ID, 'ACTIVE', actor);

    expect(result).toMatchObject({ status: 'ACTIVE', changed: false });
    expect(prisma.tenant.update).not.toHaveBeenCalled();
    expect(prisma.platformAuditLog.create).not.toHaveBeenCalled();
  });

  it('throws when the school does not exist', async () => {
    const { service } = build();

    await expect(
      service.updateStatus(TENANT_ID, 'SUSPENDED', actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlatformTenantsService.setModule', () => {
  it('upserts the module switch and audits the change', async () => {
    const { service, prisma } = build();

    await service.setModule(TENANT_ID, 'TRANSPORT', false, actor);

    expect(prisma.tenantModule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_module: { tenantId: TENANT_ID, module: 'TRANSPORT' } },
        create: { tenantId: TENANT_ID, module: 'TRANSPORT', enabled: false },
        update: { enabled: false },
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'tenant.module.changed',
          entityType: 'tenant_module',
          newValues: { module: 'TRANSPORT', enabled: false },
        }),
      }),
    );
  });
});

describe('PlatformTenantsService.setFlag', () => {
  it('upserts the feature flag and audits the change', async () => {
    const { service, prisma } = build();

    await service.setFlag(TENANT_ID, 'notifications.whatsapp', true, actor);

    expect(prisma.tenantFeatureFlag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_key: { tenantId: TENANT_ID, key: 'notifications.whatsapp' },
        },
        create: {
          tenantId: TENANT_ID,
          key: 'notifications.whatsapp',
          enabled: true,
        },
        update: { enabled: true },
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'tenant.flag.changed',
          entityType: 'tenant_feature_flag',
        }),
      }),
    );
  });
});
