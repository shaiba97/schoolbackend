import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

// @nestjs/jwt ships ESM only, which this Jest (CommonJS) setup cannot require.
// Same factory-form mock the auth suites use to keep the real module out of
// the transform pipeline.
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn().mockResolvedValue(true),
}));

import { PlatformAuthService } from './platform-auth.service';

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'user-platform-1';

function platformAdminUser(overrides: Record<string, unknown> = {}) {
  return {
    id: userId,
    email: 'root@platform.dev',
    passwordHash: 'hashed',
    firstName: 'Platform',
    lastName: 'Root',
    status: 'ACTIVE',
    platformAdmin: {
      id: adminId,
      userId,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
    ...overrides,
  };
}

function build(userResult: unknown, extra = {}) {
  const user = {
    findUnique: jest.fn().mockResolvedValue(userResult),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const platformAdminService = {
    platformAdmin: {
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('platform-token') };
  const prisma = {
    user,
    ...platformAdminService,
    ...extra,
  } as unknown as PrismaService;
  const service = new PlatformAuthService(prisma, jwt as never);
  return {
    service,
    user,
    jwt,
    prisma,
    platformAdminUpdate: platformAdminService.platformAdmin.update,
  };
}

describe('PlatformAuthService.platformLogin', () => {
  it('signs a platform-scoped token for a valid super admin', async () => {
    const { service, user, jwt, platformAdminUpdate } =
      build(platformAdminUser());

    const result = await service.platformLogin({
      email: 'root@platform.dev',
      password: 'secret',
    });

    expect(user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'root@platform.dev' },
        include: { platformAdmin: true },
      }),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: userId,
        email: 'root@platform.dev',
        scope: 'platform',
        role: 'SUPER_ADMIN',
      }),
    );
    expect(result.accessToken).toBe('platform-token');
    expect(result.profile.role).toBe('SUPER_ADMIN');
    // Login must heartbeat both the platform membership row and the user.
    expect(platformAdminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: adminId },
        data: { lastLoginAt: expect.any(Date) },
      }),
    );
  });

  it('rejects a login that has no platform admin record with invalid credentials', async () => {
    const { service } = build({
      id: 'user-2',
      email: 'member@school.dev',
      passwordHash: 'hashed',
      platformAdmin: null,
    });

    await expect(
      service.platformLogin({ email: 'member@school.dev', password: 'secret' }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('rejects a wrong password with the same generic message', async () => {
    const bcrypt = require('bcrypt');
    bcrypt.compare.mockResolvedValueOnce(false);
    const { service } = build(platformAdminUser());

    await expect(
      service.platformLogin({ email: 'root@platform.dev', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a suspended platform admin even with a valid password', async () => {
    const { service, jwt } = build(
      platformAdminUser({
        platformAdmin: {
          id: adminId,
          userId,
          role: 'SUPER_ADMIN',
          status: 'SUSPENDED',
        },
      }),
    );

    await expect(
      service.platformLogin({ email: 'root@platform.dev', password: 'secret' }),
    ).rejects.toThrow('Platform admin account is not active');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('rejects a suspended underlying user account', async () => {
    const { service } = build(platformAdminUser({ status: 'SUSPENDED' }));

    await expect(
      service.platformLogin({ email: 'root@platform.dev', password: 'secret' }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('rejects an unknown email without user oracle details', async () => {
    const { service } = build(null);

    await expect(
      service.platformLogin({
        email: 'nobody@platform.dev',
        password: 'secret',
      }),
    ).rejects.toThrow('Invalid credentials');
  });
});

describe('PlatformAuthService.platformMe', () => {
  it('returns the admin profile for the signed-in platform user', async () => {
    const { service } = build(platformAdminUser());

    const me = await service.platformMe(userId);

    expect(me.user.id).toBe(userId);
    expect(me.profile.role).toBe('SUPER_ADMIN');
  });

  it('rejects a user whose platform admin record is missing', async () => {
    const { service } = build({
      id: userId,
      email: 'x@y.dev',
      passwordHash: 'h',
      platformAdmin: null,
    });

    await expect(service.platformMe(userId)).rejects.toThrow(
      'Invalid credentials',
    );
  });
});
