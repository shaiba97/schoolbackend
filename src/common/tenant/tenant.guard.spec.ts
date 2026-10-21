import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

import { TenantGuard } from './tenant.guard';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = 'user-1';

interface ScenarioOverrides {
  tenantStatus?: string;
  membershipStatus?: string;
  user?: unknown;
}

function buildScenario(overrides: ScenarioOverrides = {}) {
  const membership = {
    id: 'membership-1',
    tenantId,
    status: overrides.membershipStatus ?? 'ACTIVE',
    tenant: { id: tenantId, status: overrides.tenantStatus ?? 'ACTIVE' },
    roles: [{ role: { slug: 'ADMIN' } }],
  };
  const prisma = {
    tenantMembership: { findFirst: jest.fn().mockResolvedValue(membership) },
  } as unknown as PrismaService;
  return { guard: new TenantGuard(prisma), prisma };
}

function makeRequest(user: unknown, headers: Record<string, string> = {}) {
  return { user, headers, tenant: undefined } as unknown as Record<string, unknown>;
}

function makeContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('TenantGuard tenant status', () => {
  const originalNoSession = process.env.AUTH_NO_SESSION;

  beforeEach(() => {
    process.env.AUTH_NO_SESSION = 'false';
  });
  afterAll(() => {
    process.env.AUTH_NO_SESSION = originalNoSession;
  });

  it('allows an active member of an ACTIVE tenant', async () => {
    const { guard } = buildScenario();
    const request = makeRequest({ userId }, { 'x-tenant-id': tenantId });

    const ok = await guard.canActivate(makeContext(request));

    expect(ok).toBe(true);
    expect((request as { tenant?: { roles: string[] } }).tenant?.roles).toEqual(['ADMIN']);
  });

  it.each(['SUSPENDED', 'ARCHIVED', 'PENDING'])(
    'blocks an active member when the tenant is %s',
    async (status) => {
      const { guard } = buildScenario({ tenantStatus: status });
      const request = makeRequest({ userId }, { 'x-tenant-id': tenantId });

      await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
        'This school is currently locked',
      );
    },
  );

  it('lets a platform-scoped token through without a membership', async () => {
    const { guard, prisma } = buildScenario({ tenantStatus: 'SUSPENDED' });
    const request = makeRequest(
      { userId: 'platform-user', scope: 'platform', roles: [] },
      { 'x-tenant-id': tenantId },
    );

    const ok = await guard.canActivate(makeContext(request));

    expect(ok).toBe(true);
    expect((request as { tenant?: { roles: string[]; membershipId: string } }).tenant?.membershipId).toBe(
      'platform',
    );
    const findFirst = (prisma as unknown as {
      tenantMembership: { findFirst: jest.Mock };
    }).tenantMembership.findFirst;
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('still requires the tenant header for a platform-scoped token', async () => {
    const { guard } = buildScenario();
    const request = makeRequest({ userId: 'platform-user', scope: 'platform' });

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(
      'Missing X-Tenant-Id header',
    );
  });
});
