import { ForbiddenException } from '@nestjs/common';
import { WardGuard } from './ward.guard';

const TENANT = 'tenant-1';
const GUARDIAN_USER = 'guardian-user';
const GUARDIAN_ID = 'guardian-1';
const WARD_ID = 'student-1';

function contextOf(request: Record<string, any>) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

function guardWith(link: unknown, guardian: unknown = { id: GUARDIAN_ID }) {
  const prisma = {
    guardian: { findFirst: jest.fn().mockResolvedValue(guardian) },
    studentGuardian: { findFirst: jest.fn().mockResolvedValue(link) },
  };
  return new WardGuard(prisma as never);
}

function authedRequest(params: Record<string, string> = {}) {
  return {
    params,
    tenant: { tenantId: TENANT },
    user: { userId: GUARDIAN_USER },
  };
}

describe('WardGuard', () => {
  it('passes routes without a childId through', async () => {
    const guard = guardWith(null);
    await expect(guard.canActivate(contextOf(authedRequest()))).resolves.toBe(true);
  });

  it('allows a guardian linked to the requested ward', async () => {
    const guard = guardWith({ studentId: WARD_ID });
    await expect(
      guard.canActivate(contextOf(authedRequest({ childId: WARD_ID }))),
    ).resolves.toBe(true);
  });

  it("403s another family's child even with a valid session", async () => {
    const guard = guardWith(null);
    await expect(
      guard.canActivate(contextOf(authedRequest({ childId: 'other-child' }))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403s an account with no guardian profile', async () => {
    const guard = guardWith({ studentId: WARD_ID }, null);
    await expect(
      guard.canActivate(contextOf(authedRequest({ childId: WARD_ID }))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403s when tenant or user is missing from the request', async () => {
    const guard = guardWith({ studentId: WARD_ID });
    await expect(
      guard.canActivate(contextOf({ params: { childId: WARD_ID } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
