import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

// @nestjs/jwt ships ESM only, which this Jest (CommonJS) setup cannot require.
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { AuthService } from './auth.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const lockedTenantId = '22222222-2222-4222-8222-222222222222';

function build(user: unknown) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as PrismaService;
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  return { service: new AuthService(prisma, jwt as never), jwt };
}

function userWith(lockedTenants: unknown[]) {
  return {
    id: 'user-1',
    email: 'user@school.edu',
    phone: null,
    firstName: 'Mazin',
    lastName: 'Cbag',
    avatarUrl: null,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    passwordHash: 'hashed',
    memberships: [
      {
        id: 'membership-1',
        tenantId,
        status: 'ACTIVE',
        joinedAt: new Date('2026-01-01'),
        tenant: {
          id: tenantId,
          name: 'Springfield Academy',
          slug: 'springfield',
          status: 'ACTIVE',
          currencyCode: 'SDG',
          timezone: 'UTC',
          lockedAt: null,
          lockReason: null,
        },
        roles: [{ role: { id: 'role-1', name: 'Admin', slug: 'ADMIN' } }],
      },
      ...lockedTenants,
    ],
  };
}

describe('AuthService.me and the school lock', () => {
  it('lists the schools the provider has locked', async () => {
    const lockedAt = new Date('2026-04-01T00:00:00.000Z');
    const { service } = build(
      userWith([
        {
          id: 'membership-2',
          tenantId: lockedTenantId,
          status: 'ACTIVE',
          joinedAt: new Date('2026-01-01'),
          tenant: {
            id: lockedTenantId,
            name: 'Locked School',
            slug: 'locked-school',
            status: 'SUSPENDED',
            currencyCode: 'SDG',
            timezone: 'UTC',
            lockedAt,
            lockReason: 'LICENSE_EXPIRED',
          },
          roles: [],
        },
      ]),
    );

    const result = await service.me('user-1');

    expect(result.lockedTenants).toEqual([
      {
        tenantId: lockedTenantId,
        name: 'Locked School',
        lockedAt,
        reason: 'LICENSE_EXPIRED',
      },
    ]);
  });

  it('carries the lock on the membership so a portal can show it', async () => {
    const lockedAt = new Date('2026-04-01T00:00:00.000Z');
    const { service } = build(
      userWith([
        {
          id: 'membership-2',
          tenantId: lockedTenantId,
          status: 'ACTIVE',
          joinedAt: new Date('2026-01-01'),
          tenant: {
            id: lockedTenantId,
            name: 'Locked School',
            slug: 'locked-school',
            status: 'SUSPENDED',
            currencyCode: 'SDG',
            timezone: 'UTC',
            lockedAt,
            lockReason: 'LICENSE_EXPIRED',
          },
          roles: [],
        },
      ]),
    );

    const result = await service.me('user-1');
    const locked = result.memberships.find((m) => m.tenantId === lockedTenantId);

    expect(locked?.tenant.lockedAt).toEqual(lockedAt);
    expect(locked?.tenant.lockReason).toBe('LICENSE_EXPIRED');
  });

  it('reports no locked schools for a user in good standing', async () => {
    const { service } = build(userWith([]));

    const result = await service.me('user-1');

    expect(result.lockedTenants).toEqual([]);
  });

  it('refuses a missing user', async () => {
    const { service } = build(null);

    await expect(service.me('user-1')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
