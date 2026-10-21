import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

import { PlatformAdminGuard } from './platform-admin.guard';

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'user-platform-1';

function makeRequest(user: unknown) {
  return { user, platformAdmin: undefined } as unknown as Record<
    string,
    unknown
  >;
}

function makeContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function build(adminRecord: unknown) {
  const prisma = {
    platformAdmin: { findUnique: jest.fn().mockResolvedValue(adminRecord) },
  } as unknown as PrismaService;
  return { guard: new PlatformAdminGuard(prisma), prisma };
}

describe('PlatformAdminGuard', () => {
  it('attaches the platform admin when a platform-scoped token is active', async () => {
    const { guard } = build({
      id: adminId,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    const request = makeRequest({ userId, scope: 'platform' });

    const ok = await guard.canActivate(makeContext(request));

    expect(ok).toBe(true);
    expect(request.platformAdmin).toEqual({
      id: adminId,
      userId,
      role: 'SUPER_ADMIN',
      scope: 'platform',
    });
  });

  it('rejects tenant-scoped JWTs — no platform access without a platform token', async () => {
    const { guard } = build(undefined);
    const request = makeRequest({ userId: 'member-1', scope: undefined });

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a JWT with a foreign scope value (token hopping)', async () => {
    const { guard } = build(undefined);
    const request = makeRequest({ userId: 'member-1', scope: 'tenant-admin' });

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a platform user whose admin record was deleted', async () => {
    const { guard } = build(null);
    const request = makeRequest({ userId, scope: 'platform' });

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Platform admin access required',
    );
  });

  it('rejects a suspended platform admin', async () => {
    const { guard } = build({
      id: adminId,
      role: 'SUPPORT',
      status: 'SUSPENDED',
    });
    const request = makeRequest({ userId, scope: 'platform' });

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Platform admin account is not active',
    );
  });

  it('rejects when there is no authenticated user', async () => {
    const { guard } = build(undefined);
    const request = makeRequest(undefined);

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
