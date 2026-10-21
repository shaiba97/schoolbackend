import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { PlatformProvisioningService } from './platform-provisioning.service';
import type { PlatformActor } from './platform-tenants.service';

const actor: PlatformActor = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'user-platform-1',
  role: 'SUPER_ADMIN',
};

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '00000000-0000-4000-8000-000000000001';

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        tenant: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({
            id: TENANT_ID,
            name: 'Springfield Academy',
            nameAr: 'أكاديمية سبرينغفيلد',
            slug: 'springfield-academy',
            status: 'ACTIVE',
            countryCode: 'SA',
            currencyCode: 'SAR',
            timezone: 'Asia/Riyadh',
          }),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({
            id: 'user-new',
            email: 'ada@springfield.edu',
            firstName: 'Ada',
            lastName: 'Lovelace',
            phone: '+966500000000',
            staffNumber: 'STF001',
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
          create: jest.fn().mockResolvedValue({
            id: 'license-new',
            seats: 400,
          }),
        },
        platformPlan: {
          findUnique: jest.fn().mockResolvedValue({
            id: PLAN_ID,
            code: 'PRIMARY',
            name: 'Primary Plan',
            price: 800,
            currency: 'USD',
            durationDays: 365,
          }),
        },
        platformAuditLog: {
          create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
        },
        ...overrides,
      }),
    ),
    platformPlan: {
      findUnique: jest.fn().mockResolvedValue({
        id: PLAN_ID,
        code: 'PRIMARY',
        name: 'Primary Plan',
        price: 800,
        currency: 'USD',
        durationDays: 365,
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
  nameAr: 'أكاديمية سبرينغفيلد',
  countryCode: 'SA',
  email: 'office@springfield.edu',
  phone: '+966500000001',
  adminName: 'Ada Lovelace',
  adminEmail: 'ada@springfield.edu',
  adminPhone: '+966500000000',
  adminPassword: 'School@12345',
  planCode: 'PRIMARY',
  studentCount: 400,
};

describe('PlatformProvisioningService.provision', () => {
  it('creates the school with the currency and timezone of its market', async () => {
    const { service, prisma } = build();

    const result = await service.provision(validInput, actor);

    const tx = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    void tx;
    const created = (prisma.$transaction as jest.Mock).mock.results;
    void created;
    expect(result.tenant.currencyCode).toBe('SAR');
    expect(result.tenant.timezone).toBe('Asia/Riyadh');
    expect(result.tenant.nameAr).toBe('أكاديمية سبرينغفيلد');
  });

  it('takes the slug from the school name', async () => {
    const { service, prisma } = build();

    await service.provision(validInput, actor);

    const tx = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    void tx;
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValues: expect.objectContaining({ slug: 'springfield-academy' }),
        }),
      }),
    );
  });

  it('gives the administrator a staff ID', async () => {
    const { service } = build();

    const result = await service.provision(validInput, actor);

    expect(result.admin.staffNumber).toBe('STF001');
  });

  it('enables every portal and every feature flag', async () => {
    const { service } = build();

    const result = await service.provision(validInput, actor);

    expect(result.modules).toEqual([
      'ADMIN',
      'ACADEMIC',
      'FINANCIAL',
      'TEACHER',
      'GUARDIAN',
      'STUDENT',
      'TRANSPORT',
    ]);
    expect(Object.keys(result.featureFlags)).toHaveLength(5);
  });

  it('prices the subscription per student per month', async () => {
    const { service } = build();

    const result = await service.provision(validInput, actor);

    // 800 USD per student per month, 400 students.
    expect(result.license?.monthlyUsd).toBe(320000);
    expect(result.license?.studentCount).toBe(400);
  });

  it('records the licensed student count on the license', async () => {
    const { service, prisma } = build();

    await service.provision(validInput, actor);

    const tx = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    void tx;
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newValues: expect.objectContaining({ studentCount: 400 }),
        }),
      }),
    );
  });

  it('refuses a duplicate administrator email', async () => {
    const { service, prisma } = build();
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: any) => unknown) =>
        fn({
          tenant: { findMany: jest.fn().mockResolvedValue([]) },
          user: {
            findUnique: jest.fn().mockResolvedValue({ id: 'user-existing' }),
            findMany: jest.fn().mockResolvedValue([]),
          },
          platformPlan: { findUnique: jest.fn().mockResolvedValue(null) },
        }),
    );

    await expect(service.provision(validInput, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('gives a second school with the same name a different slug', async () => {
    const { service, prisma } = build();
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: any) => unknown) =>
        fn({
          tenant: {
            findMany: jest.fn().mockResolvedValue([{ slug: 'springfield-academy' }]),
            create: jest.fn().mockResolvedValue({
              id: TENANT_ID,
              name: 'Springfield Academy',
              slug: 'springfield-academy-2',
              status: 'ACTIVE',
              countryCode: 'SA',
              currencyCode: 'SAR',
              timezone: 'Asia/Riyadh',
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({
              id: 'user-new',
              email: 'ada@springfield.edu',
              firstName: 'Ada',
              staffNumber: 'STF002',
            }),
          },
          tenantMembership: { create: jest.fn().mockResolvedValue({ id: 'm' }) },
          role: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'r' }),
          },
          membershipRole: { create: jest.fn().mockResolvedValue({ id: 'mr' }) },
          tenantModule: { createMany: jest.fn().mockResolvedValue({ count: 7 }) },
          tenantFeatureFlag: { createMany: jest.fn().mockResolvedValue({ count: 5 }) },
          tenantLicense: { create: jest.fn().mockResolvedValue({ id: 'l' }) },
          platformPlan: { findUnique: jest.fn().mockResolvedValue(null) },
        }),
    );

    const result = await service.provision(validInput, actor);

    expect(result.tenant.slug).toBe('springfield-academy-2');
  });

  it('rejects a weak administrator password', async () => {
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

  it('is refused for a support agent', async () => {
    const { service } = build();

    await expect(
      service.provision(validInput, { ...actor, role: 'SUPPORT' }),
    ).rejects.toThrow('This action requires super admin access');
  });
});
