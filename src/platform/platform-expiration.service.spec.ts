import type { PrismaService } from '../prisma/prisma.service';

import { PlatformExpirationService } from './platform-expiration.service';

function build(due: unknown[] = []) {
  const prisma = {
    tenantLicense: {
      findMany: jest.fn().mockResolvedValue(due),
      update: jest.fn().mockResolvedValue({ id: 'lic-1' }),
    },
    tenant: {
      update: jest.fn().mockResolvedValue({ id: 'tenant-1' }),
    },
    platformAuditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  } as unknown as PrismaService;

  return { service: new PlatformExpirationService(prisma), prisma };
}

describe('PlatformExpirationService.sweep', () => {
  it('expires a licence that is past its end date and locks the school', async () => {
    const { service, prisma } = build([
      {
        id: 'lic-1',
        tenantId: 'tenant-1',
        expiresAt: new Date('2026-03-31'),
        tenant: { id: 'tenant-1', name: 'Springfield Academy' },
      },
    ]);

    const result = await service.sweep();

    expect(result.expired).toBe(1);
    expect(result.schools[0]).toMatchObject({
      tenantId: 'tenant-1',
      name: 'Springfield Academy',
    });
    expect(prisma.tenantLicense.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lic-1' },
        data: expect.objectContaining({
          status: 'EXPIRED',
          terminationReason: 'LICENSE_EXPIRED',
        }),
      }),
    );
    expect(prisma.tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tenant-1' },
        data: expect.objectContaining({
          status: 'SUSPENDED',
          lockReason: 'LICENSE_EXPIRED',
        }),
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'platform.subscription.expired',
          tenantId: 'tenant-1',
        }),
      }),
    );
  });

  it('leaves a licence that has not ended alone', async () => {
    const { service, prisma } = build([]);

    const result = await service.sweep();

    expect(result.expired).toBe(0);
    expect(prisma.tenantLicense.update).not.toHaveBeenCalled();
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('only looks at active licences that are already past their end date', async () => {
    const { service, prisma } = build([]);

    await service.sweep();

    expect(prisma.tenantLicense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'ACTIVE',
          expiresAt: { lt: expect.any(Date) },
        },
      }),
    );
  });

  it('is idempotent: a second run finds nothing left to expire', async () => {
    const { service, prisma } = build([
      {
        id: 'lic-1',
        tenantId: 'tenant-1',
        expiresAt: new Date('2026-03-31'),
        tenant: { id: 'tenant-1', name: 'Springfield Academy' },
      },
    ]);

    await service.sweep();

    // After the first run the licence is no longer ACTIVE, so the query the
    // second run makes returns nothing.
    (prisma.tenantLicense.findMany as jest.Mock).mockResolvedValue([]);
    const second = await service.sweep();

    expect(second.expired).toBe(0);
    expect(prisma.tenantLicense.update).toHaveBeenCalledTimes(1);
  });
});
