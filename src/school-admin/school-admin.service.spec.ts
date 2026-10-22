import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PortalModule } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

import { SchoolAdminService } from './school-admin.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user-admin-1';

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue({
        id: USER_ID,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@school.edu',
        phone: '+249900000000',
        avatarUrl: null,
        staffNumber: 'STF001',
        status: 'ACTIVE',
        lastLoginAt: new Date(),
      }),
      update: jest.fn().mockResolvedValue({
        id: USER_ID,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@school.edu',
        phone: '+249900000000',
        avatarUrl: null,
        staffNumber: 'STF001',
      }),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        id: TENANT_ID,
        name: 'Springfield Academy',
        nameAr: 'أكاديمية سبرينغفيلد',
        email: 'office@school.edu',
        phone: null,
        logoUrl: null,
        websiteUrl: null,
        countryCode: 'SD',
        currencyCode: 'SDG',
        timezone: 'Africa/Khartoum',
        weekendDays: ['FRI', 'SAT'],
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01'),
      }),
      update: jest.fn().mockResolvedValue({ id: TENANT_ID, name: 'Springfield Academy' }),
    },
    tenantLicense: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'lic-1',
        status: 'ACTIVE',
        startedAt: new Date('2026-01-01'),
        expiresAt: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
        seats: 400,
        yearlyPrice: 800,
        terminatedAt: null,
        terminationReason: null,
        plan: {
          id: 'plan-1',
          code: 'PRIMARY',
          name: 'Primary Plan',
          tier: 'PRIMARY',
          price: 800,
          currency: 'USD',
          durationDays: 365,
          includedModules: [
            PortalModule.ADMIN,
            PortalModule.ACADEMIC,
            PortalModule.TEACHER,
            PortalModule.STUDENT,
          ],
        },
      }),
    },
    role: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'role-1',
          name: 'Admin',
          slug: 'ADMIN',
          description: null,
          portal: PortalModule.ADMIN,
          isSystemRole: true,
          _count: { memberships: 2 },
        },
      ]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'role-new',
        name: data.name,
        slug: data.slug,
        description: data.description,
        portal: data.portal,
        isSystemRole: false,
      })),
      delete: jest.fn().mockResolvedValue({ id: 'role-new' }),
    },
    platformPlan: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'plan-1',
        code: 'ADVANCED',
        name: 'Advanced Plan',
        price: 3500,
        currency: 'USD',
      }),
    },
    platformAuditLog: {
      create: jest.fn().mockResolvedValue({ createdAt: new Date() }),
    },
    ...overrides,
  } as unknown as PrismaService;

  return { service: new SchoolAdminService(prisma), prisma };
}

describe('SchoolAdminService.overview', () => {
  it('reports the admin, the school, the subscription, and the portals', async () => {
    const { service } = build();

    const result = await service.overview(TENANT_ID, USER_ID);

    expect(result.admin).toMatchObject({ email: 'ada@school.edu', role: 'SCHOOL_ADMIN' });
    expect(result.tenant.name).toBe('Springfield Academy');
    expect(result.subscription).toMatchObject({
      tier: 'PRIMARY',
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      studentCount: 400,
      // 800 a year is 66.67 a month.
      yearlyPrice: 800,
      monthlyPrice: 66.67,
    });
  });

  it('marks the portals the tier does not grant as locked', async () => {
    const { service } = build();

    const result = await service.overview(TENANT_ID, USER_ID);

    const transport = result.portals.find((row) => row.portal === 'TRANSPORT');
    const academic = result.portals.find((row) => row.portal === 'ACADEMIC');
    expect(transport?.unlocked).toBe(false);
    expect(academic?.unlocked).toBe(true);
  });

  it('offers only the positions the tier allows', async () => {
    const { service } = build();

    const result = await service.overview(TENANT_ID, USER_ID);

    const positions = result.allowedPositions.map((row) => row.position);
    expect(positions).toContain('ACADEMIC_AFFAIRS');
    expect(positions).not.toContain('FINANCIAL_AFFAIRS');
    expect(positions).not.toContain('TRANSPORT_COORDINATOR');
  });
});

describe('SchoolAdminService.updateProfile', () => {
  it('saves the admin personal details', async () => {
    const { service, prisma } = build();

    await service.updateProfile(USER_ID, { firstName: 'Ada L.', phone: '+249900000001' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({ firstName: 'Ada L.', phone: '+249900000001' }),
      }),
    );
  });
});

describe('SchoolAdminService.updateTenant', () => {
  it('saves the school details', async () => {
    const { service, prisma } = build();

    await service.updateTenant(TENANT_ID, { name: 'Springfield Academy', countryCode: 'SA' });

    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_ID },
        data: expect.objectContaining({ name: 'Springfield Academy', countryCode: 'SA' }),
      }),
    );
  });
});

describe('SchoolAdminService.createPosition', () => {
  it('refuses a position for a portal the tier does not grant', async () => {
    const { service } = build();

    await expect(
      service.createPosition(TENANT_ID, {
        title: 'Head of Transport',
        portal: PortalModule.TRANSPORT,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a position for a portal the tier grants', async () => {
    const { service, prisma } = build();

    const result = await service.createPosition(TENANT_ID, {
      title: 'Head of Academic',
      portal: PortalModule.ACADEMIC,
    });

    expect(result.portal).toBe(PortalModule.ACADEMIC);
    expect(prisma.role.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          portal: PortalModule.ACADEMIC,
        }),
      }),
    );
  });

  it('refuses a duplicate title', async () => {
    const { service, prisma } = build();
    (prisma.role.findFirst as jest.Mock).mockResolvedValue({ id: 'role-1' });

    await expect(
      service.createPosition(TENANT_ID, {
        title: 'Head of Academic',
        portal: PortalModule.ACADEMIC,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SchoolAdminService.deletePosition', () => {
  it('refuses to delete a position that still has people in it', async () => {
    const { service, prisma } = build();
    (prisma.role.findFirst as jest.Mock).mockResolvedValue({
      id: 'role-1',
      _count: { memberships: 3 },
    });

    await expect(service.deletePosition(TENANT_ID, 'role-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('deletes an empty position', async () => {
    const { service, prisma } = build();
    (prisma.role.findFirst as jest.Mock).mockResolvedValue({
      id: 'role-1',
      _count: { memberships: 0 },
    });

    const result = await service.deletePosition(TENANT_ID, 'role-1');

    expect(result).toEqual({ id: 'role-1', deleted: true });
    expect(prisma.role.delete).toHaveBeenCalled();
  });

  it('reports a position that is not the school own', async () => {
    const { service, prisma } = build();
    (prisma.role.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.deletePosition(TENANT_ID, 'role-9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('SchoolAdminService.requestTierChange', () => {
  it('records the request for the platform to answer', async () => {
    const { service, prisma } = build();

    const result = await service.requestTierChange(TENANT_ID, USER_ID, {
      planId: 'plan-1',
      note: 'We added a transport fleet.',
    });

    expect(result.requested).toBe(true);
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'tenant.tier_change_requested',
          tenantId: TENANT_ID,
        }),
      }),
    );
  });

  it('reports an unknown plan', async () => {
    const { service, prisma } = build();
    (prisma.platformPlan.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      service.requestTierChange(TENANT_ID, USER_ID, { planId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
