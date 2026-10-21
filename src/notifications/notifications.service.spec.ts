import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER_A = 'user-a';
const USER_B = 'user-b';

function makeDb() {
  const db: any = {
    notification: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: where.id })),
      create: jest.fn(),
    },
  };
  const prisma = {
    withTenant: jest.fn(async (_t: string, cb: (tx: unknown) => Promise<unknown>) => cb(db)),
    withTenantRead: jest.fn(async (_t: string, cb: (tx: unknown) => Promise<unknown>) => cb(db)),
  } as unknown as PrismaService;
  const targeting = { resolveTargetUserIds: jest.fn().mockResolvedValue([]) } as any;
  const realtime = { emitNotification: jest.fn().mockResolvedValue(undefined) } as any;
  return { db, service: new NotificationsService(prisma, targeting, realtime) };
}

describe('NotificationsService markAsRead', () => {
  it('scopes the lookup by userId so one member cannot mark another member read', async () => {
    const { db, service } = makeDb();
    db.notification.findFirst.mockResolvedValue({ id: 'n1' });

    await service.markAsRead(TENANT, 'n1', USER_A);

    expect(db.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'n1', tenantId: TENANT, userId: USER_A }) }),
    );
  });

  it('throws NotFound when the notification belongs to another user', async () => {
    const { db, service } = makeDb();
    // Simulates the ownership filter rejecting the row.
    db.notification.findFirst.mockResolvedValue(null);

    await expect(service.markAsRead(TENANT, 'n1', USER_B)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.notification.update).not.toHaveBeenCalled();
  });

  it('does not update anything when the notification is absent', async () => {
    const { db, service } = makeDb();
    db.notification.findFirst.mockResolvedValue(null);

    await expect(service.markAsRead(TENANT, 'missing', USER_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.notification.update).not.toHaveBeenCalled();
  });
});

describe('NotificationsService findMyNotifications', () => {
  it('scopes reads to the requesting user', async () => {
    const { db, service } = makeDb();

    await service.findMyNotifications(TENANT, USER_A);

    expect(db.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, userId: USER_A } }),
    );
  });
});

describe('NotificationsService markAllRead', () => {
  it('marks only the caller inbox read, never another member', async () => {
    const { db, service } = makeDb();
    db.notification.updateMany = jest.fn().mockResolvedValue({ count: 3 });

    const result = await service.markAllRead(TENANT, USER_A);

    expect(db.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, userId: USER_A, readAt: null } }),
    );
    expect(result).toEqual({ marked: 3 });
  });
});