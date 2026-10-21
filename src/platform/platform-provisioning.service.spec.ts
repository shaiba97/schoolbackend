import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { PlatformProvisioningService } from './platform-provisioning.service';
import type { PlatformActor } from './platform-tenants.service';

const actor: PlatformActor = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'user-platform-1',
  role: 'SUPER_ADMIN',
};

const PLAN_ID = '00000000-0000-4000-8000-000000000001';

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        tenant: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({
            id: 'tenant-new',
            name: 'Springfield Academy',
            slug: 'springfield-academy',
            status: 'ACTIVE',
          }),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({
            id: 'user-new',
            email: 'ada@springfield.edu',
            firstName: 'Ada',
            lastName: 'Lovelace',
          }),
        },
        tenantMembership: {
          create: jest.fn().mockResolvedValue({ id: 'membership-new' }),
        },
        role: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'role-new', slug: 'ADMIN' }),
        },
        membershipRole: {
          create: jest.fn().mockResolvedValue({ id: 'membership-role-new' }),
        },
        tenantModule: {
          createMany: jest.fn().mockResolvedValue({ count: 7 }),
        },
        tenantFeatureFlag: {
          createMany: jest.fn().mockResolvedValue({ count: 5 }),
        },
        tenantLicense: {
          create: jest.fn().mockResolvedValue({ id: 'license-new' }),
        },
        platformPlan: {
          findUnique: jest.fn().mockResolvedValue({
            id: PLAN_ID,
            code: 'LEGACY',
            name: 'Legacy',
            billingModel: 'LIFETIME',
            price: 0,
            isActive: true,
          }),
        },
        platformAuditLog: {
          create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
        },
      }),
    ),
    platformPlan: {
      findUnique: jest.fn().mockResolvedValue({
        id: PLAN_ID,
        code: 'LEGACY',
        name: 'Legacy',
        billingModel: 'LIFETIME',
        price: 0,
        isActive: true,
      }),
    },
    platformAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    ...overrides,
  } as unknown as PrismaService;

  return { service: new PlatformProvisioningService(prisma), prisma };
}

const validInput = {
  name: 'Springfield Academy',
  slug: 'springfield-academy',
  email: 'office@springfield.edu',
  phone: '+249900000001',
  countryCode: 'SD',
  currencyCode: 'SDG',
  timezone: 'Africa/Khartoum',
  adminName: 'Ada Lovelace',
  adminEmail: 'ada@springfield.edu',
  adminPassword: 'School@12345',
  planCode: 'LEGACY',
  modules: ['ADMIN', 'ACADEMIC'],
  featureFlags: { 'portal.transport.tracking': true },
};

describe('PlatformProvisioningService.provision', () => {
  it('creates the tenant with its slug, admin account, and membership', async () => {
    const { service } = build();

    const result = await service.provision(validInput, actor);

    expect(result.tenant.id).toBe('tenant-new');
    expect(result.admin.email).toBe('ada@springfield.edu');
    expect(result.modules).toEqual(['ADMIN', 'ACADEMIC']);
  });

  it('refuses a duplicate slug', async () => {
    const { service, prisma } = build();
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: any) => unknown) =>
      fn({
        tenant: {
          findUnique: jest.fn().mockResolvedValue({ id: 'tenant-existing' }),
          create: jest.fn(),
        },
        platformPlan: { findUnique: jest.fn().mockResolvedValue(null) },
      }),
    );

    await expect(service.provision(validInput, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses a duplicate admin email', async () => {
    const { service, prisma } = build();
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: any) => unknown) =>
      fn({
        tenant: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-existing' }), create: jest.fn() },
        platformPlan: { findUnique: jest.fn().mockResolvedValue(null) },
      }),
    );

    await expect(service.provision(validInput, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a weak admin password', async () => {
    const { service } = build();

    await expect(
      service.provision({ ...validInput, adminPassword: 'short' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown plan', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.provision(validInput, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('enables every portal when no module list is supplied', async () => {
    const { service, prisma } = build();

    const result = await service.provision({ ...validInput, modules: undefined }, actor);

    expect(result.modules).toEqual(
      expect.arrayContaining([
        'ADMIN',
        'ACADEMIC',
        'FINANCIAL',
        'TEACHER',
        'GUARDIAN',
        'STUDENT',
        'TRANSPORT',
      ]),
    );
  });

  it('audits the provisioning with the new tenant id', async () => {
    const { service, prisma } = build();

    await service.provision(validInput, actor);

    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: actor.id,
          action: 'tenant.provisioned',
          entityType: 'tenant',
          entityId: 'tenant-new',
        }),
      }),
    );
  });

  it('is refused for a support agent', async () => {
    const { service } = build();

    await expect(
      service.provision(validInput, { ...actor, role: 'SUPPORT' }),
    ).rejects.toThrow('This action requires super admin access');
  });
});
