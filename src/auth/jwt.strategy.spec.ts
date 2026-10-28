import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

// @nestjs/passport pulls @nestjs/jwt types; keep the ESM-only package out.
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));
// Same story for @nestjs/config (ESM-only in this CommonJS Jest setup).
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { JwtStrategy, JwtPayload } from './jwt.strategy';

const tenantId = '11111111-1111-4111-8111-111111111111';
const lockedAt = new Date('2026-04-01T00:00:00.000Z');
const lockedEpoch = Math.floor(lockedAt.getTime() / 1000);

function build(tenant: unknown) {
  const findUnique = jest.fn().mockResolvedValue(tenant);
  const prisma = { tenant: { findUnique } } as unknown as PrismaService;
  const config = { get: (key: string) => (key === 'JWT_SECRET' ? 'test-secret' : undefined) };
  return { strategy: new JwtStrategy(config as never, prisma), findUnique };
}

function payloadWith(extra: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'user-1',
    email: 'user@school.edu',
    tenantId,
    roles: ['ADMIN'],
    iat: lockedEpoch + 60,
    ...extra,
  };
}

describe('JwtStrategy session invalidation for suspended or locked schools', () => {
  it('rejects a session while the school is suspended', async () => {
    const { strategy, findUnique } = build({ status: 'SUSPENDED', lockedAt: null });

    await expect(strategy.validate(payloadWith())).rejects.toThrow(
      new UnauthorizedException(
        'This school is currently locked by the provider. Contact support.',
      ),
    );
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: tenantId },
      select: { status: true, lockedAt: true },
    });
  });

  it('rejects sessions issued at or before the lock moment (fail-closed equality)', async () => {
    for (const iat of [lockedEpoch - 1, lockedEpoch]) {
      const { strategy } = build({ status: 'ACTIVE', lockedAt });
      await expect(
        strategy.validate(payloadWith({ iat })),
      ).rejects.toThrow(
        'This session was issued before the school was locked. Sign in again.',
      );
    }
  });

  it('accepts sessions issued after the lock moment', async () => {
    const { strategy } = build({ status: 'ACTIVE', lockedAt });

    const result = await strategy.validate(payloadWith({ iat: lockedEpoch + 1 }));

    expect(result).toEqual({
      userId: 'user-1',
      email: 'user@school.edu',
      tenantId,
      roles: ['ADMIN'],
      scope: undefined,
      role: undefined,
    });
  });

  it('accepts sessions for an unlocked school', async () => {
    const { strategy } = build({ status: 'ACTIVE', lockedAt: null });

    await expect(strategy.validate(payloadWith())).resolves.toEqual({
      userId: 'user-1',
      email: 'user@school.edu',
      tenantId,
      roles: ['ADMIN'],
      scope: undefined,
      role: undefined,
    });
  });

  it('lets platform-scoped super-admin sessions keep working for any school', async () => {
    const { strategy, findUnique } = build({ status: 'SUSPENDED', lockedAt });

    const payload = payloadWith({ scope: 'platform', role: 'SUPER_ADMIN' });

    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'user-1',
      email: 'user@school.edu',
      tenantId,
      roles: ['ADMIN'],
      scope: 'platform',
      role: 'SUPER_ADMIN',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('skips the tenant check for tenant-less tokens', async () => {
    const { strategy, findUnique } = build({ status: 'SUSPENDED', lockedAt });

    await expect(strategy.validate(payloadWith({ tenantId: undefined }))).resolves.toMatchObject({
      userId: 'user-1',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects tokens missing the subject', async () => {
    const { strategy } = build({ status: 'ACTIVE', lockedAt: null });

    await expect(strategy.validate({ iat: lockedEpoch } as JwtPayload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
