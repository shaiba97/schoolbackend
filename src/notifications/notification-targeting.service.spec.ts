import { NotificationTargetingService } from './notification-targeting.service';

const TENANT = 'tenant-1';

function setup(db: Record<string, any>) {
  const prisma = db;
  return new NotificationTargetingService(prisma as never);
}

describe('NotificationTargetingService guardian inclusion', () => {
  it('adds ward guardians alongside the student for a STUDENT target', async () => {
    const db = {
      student: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'student-user' }),
      },
      studentGuardian: {
        findMany: jest.fn().mockResolvedValue([
          { guardian: { userId: 'guardian-user' } },
          { guardian: { userId: null } },
        ]),
      },
    };
    const service = setup(db);

    const userIds = await service.resolveTargetUserIds(TENANT, 'STUDENT', 'student-1');

    expect(userIds).toContain('student-user');
    expect(userIds).toContain('guardian-user');
    expect(db.studentGuardian.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT, studentId: { in: ['student-1'] } },
      }),
    );
  });

  it('adds guardians of every enrolled student for a CLASS target', async () => {
    const db = {
      studentEnrollment: {
        findMany: jest.fn().mockResolvedValue([{ studentId: 's-1' }, { studentId: 's-2' }]),
      },
      student: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'student-user' }]),
      },
      studentGuardian: {
        findMany: jest.fn().mockResolvedValue([{ guardian: { userId: 'guardian-user' } }]),
      },
    };
    const service = setup(db);

    const userIds = await service.resolveTargetUserIds(TENANT, 'CLASS', 'class-1');

    expect(userIds).toContain('student-user');
    expect(userIds).toContain('guardian-user');
  });

  it('still resolves students when no guardians are linked', async () => {
    const db = {
      studentEnrollment: {
        findMany: jest.fn().mockResolvedValue([{ studentId: 's-1' }]),
      },
      student: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'student-user' }]),
      },
      studentGuardian: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = setup(db);

    const userIds = await service.resolveTargetUserIds(TENANT, 'CLASS', 'class-1');

    expect(userIds).toEqual(['student-user']);
  });
});
