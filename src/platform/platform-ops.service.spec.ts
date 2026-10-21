import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

import { PlatformOpsService } from './platform-ops.service';
import type { PlatformActor } from './platform-tenants.service';

const superAdmin: PlatformActor = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'user-platform-1',
  role: 'SUPER_ADMIN',
};

const supportAgent: PlatformActor = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  userId: 'user-platform-2',
  role: 'SUPPORT',
};

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    platformAuditLog: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    platformAnnouncement: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'ann-1',
        title: 'Maintenance window',
        body: 'The API will be down for 10 minutes.',
        severity: 'WARNING',
        isActive: true,
      }),
      update: jest.fn().mockResolvedValue({
        id: 'ann-1',
        title: 'Maintenance window',
        body: 'The API will be down for 10 minutes.',
        severity: 'CRITICAL',
        isActive: false,
      }),
    },
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    platformAdmin: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as unknown as PrismaService;

  return { service: new PlatformOpsService(prisma), prisma };
}

describe('PlatformOpsService.listAudit', () => {
  it('filters by tenant, actor, and action and paginates', async () => {
    const { service, prisma } = build();

    await service.listAudit({
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      action: 'tenant',
      page: 2,
      limit: 10,
    });

    const args = (prisma.platformAuditLog.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where).toMatchObject({
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      action: expect.objectContaining({ contains: 'tenant' }),
    });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
  });

  it('resolves tenant and actor names for the entries', async () => {
    const { service, prisma } = build();
    (prisma.platformAuditLog.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'audit-1',
        action: 'tenant.status.changed',
        entityType: 'tenant',
        entityId: 'tenant-1',
        tenantId: 'tenant-1',
        actorId: 'actor-1',
        createdAt: new Date(),
        oldValues: { status: 'ACTIVE' },
        newValues: { status: 'SUSPENDED' },
      },
    ]);
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([
      { id: 'tenant-1', name: 'Springfield Academy' },
    ]);
    (prisma.platformAdmin.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'actor-1',
        user: { firstName: 'Root', lastName: 'Admin', email: 'root@platform.dev' },
      },
    ]);

    const result = await service.listAudit({ page: 1, limit: 25 });

    expect(result.items[0]).toMatchObject({
      action: 'tenant.status.changed',
      tenantName: 'Springfield Academy',
      actorName: 'Root Admin',
    });
  });
});

describe('PlatformOpsService.listAnnouncements', () => {
  it('returns announcements newest first with their author', async () => {
    const { service, prisma } = build();
    (prisma.platformAnnouncement.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'ann-1',
        title: 'Maintenance window',
        body: 'Down for 10 minutes.',
        severity: 'WARNING',
        isActive: true,
        publishedAt: new Date(),
        createdAt: new Date(),
        createdBy: {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          user: { firstName: 'Root', lastName: 'Admin', email: 'root@platform.dev' },
        },
      },
    ]);

    const rows = await service.listAnnouncements();

    expect(rows[0]).toMatchObject({ title: 'Maintenance window', author: 'Root Admin' });
  });
});

describe('PlatformOpsService.createAnnouncement', () => {
  it('creates the announcement and audits it', async () => {
    const { service, prisma } = build();

    const result = await service.createAnnouncement(
      {
        title: 'Maintenance window',
        body: 'The API will be down for 10 minutes.',
        severity: 'WARNING',
      },
      superAdmin,
    );

    expect(result.id).toBe('ann-1');
    expect(prisma.platformAnnouncement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Maintenance window',
          createdById: superAdmin.id,
        }),
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'announcement.created' }),
      }),
    );
  });

  it('refuses a support agent', async () => {
    const { service, prisma } = build();

    await expect(
      service.createAnnouncement(
        { title: 'Test', body: 'Test', severity: 'INFO' },
        supportAgent,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.platformAnnouncement.create).not.toHaveBeenCalled();
  });

  it('refuses an empty announcement', async () => {
    const { service } = build();

    await expect(
      service.createAnnouncement({ title: '  ', body: '', severity: 'INFO' }, superAdmin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PlatformOpsService.updateAnnouncement', () => {
  it('updates the announcement and records old and new values', async () => {
    const { service, prisma } = build();
    (prisma.platformAnnouncement.findUnique as jest.Mock).mockResolvedValue({
      id: 'ann-1',
      title: 'Maintenance window',
      severity: 'WARNING',
      isActive: true,
    });

    await service.updateAnnouncement('ann-1', { isActive: false }, superAdmin);

    expect(prisma.platformAnnouncement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ann-1' },
        data: { isActive: false },
      }),
    );
    expect(prisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'announcement.updated',
          oldValues: expect.objectContaining({ isActive: true }),
          newValues: expect.objectContaining({ isActive: false }),
        }),
      }),
    );
  });

  it('throws for an unknown announcement', async () => {
    const { service } = build();

    await expect(
      service.updateAnnouncement('missing', { isActive: false }, superAdmin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an empty update', async () => {
    const { service, prisma } = build();
    (prisma.platformAnnouncement.findUnique as jest.Mock).mockResolvedValue({
      id: 'ann-1',
      title: 'Maintenance window',
      severity: 'WARNING',
      isActive: true,
    });

    await expect(
      service.updateAnnouncement('ann-1', {}, superAdmin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
