import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { StaffAttendanceService } from './staff-attendance.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TEACHER_A = 'teacher-a';
const TEACHER_B = 'teacher-b';
const USER_A = 'user-a';
const ADMIN_USER = 'admin-user';

function makeDb() {
  const db: any = {
    teacher: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    staffAttendance: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
  };
  const prisma = {
    withTenant: jest.fn(async (_t: string, cb: (tx: unknown) => Promise<unknown>) => cb(db)),
    withTenantRead: jest.fn(async (_t: string, cb: (tx: unknown) => Promise<unknown>) => cb(db)),
  } as unknown as PrismaService;
  return { db, service: new StaffAttendanceService(prisma) };
}

describe('StaffAttendanceService entries', () => {
  it('creates one row per teacher for the date', async () => {
    const { db, service } = makeDb();
    db.teacher.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.id === TEACHER_A ? { id: TEACHER_A } : null),
    );
    db.staffAttendance.upsert.mockImplementation(({ create }: any) => Promise.resolve({ id: 'row-1', ...create }));

    const result = await service.upsertEntries(TENANT, ADMIN_USER, {
      date: '2026-10-01',
      entries: [{ teacherId: TEACHER_A, status: 'PRESENT' }],
    });

    expect(result).toHaveLength(1);
    expect(db.staffAttendance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_teacherId_attendanceDate: expect.objectContaining({ teacherId: TEACHER_A }),
        }),
      }),
    );
  });

  it('rejects an unknown teacher', async () => {
    const { db, service } = makeDb();
    db.teacher.findFirst.mockResolvedValue(null);

    await expect(
      service.upsertEntries(TENANT, ADMIN_USER, {
        date: '2026-10-01',
        entries: [{ teacherId: 'ghost', status: 'PRESENT' }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.staffAttendance.upsert).not.toHaveBeenCalled();
  });

  it('rejects leftAt without PRESENT status', async () => {
    const { db, service } = makeDb();
    db.teacher.findFirst.mockResolvedValue({ id: TEACHER_A });

    await expect(
      service.upsertEntries(TENANT, ADMIN_USER, {
        date: '2026-10-01',
        entries: [{ teacherId: TEACHER_A, status: 'ABSENT', leftAt: '12:30' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.staffAttendance.upsert).not.toHaveBeenCalled();
  });

  it('stores leftAt with remarks for a mid-day departure', async () => {
    const { db, service } = makeDb();
    db.teacher.findFirst.mockResolvedValue({ id: TEACHER_A });
    db.staffAttendance.upsert.mockImplementation(({ create }: any) => Promise.resolve({ id: 'row-2', ...create }));

    const result = await service.upsertEntries(TENANT, ADMIN_USER, {
      date: '2026-10-01',
      entries: [{ teacherId: TEACHER_A, status: 'PRESENT', leftAt: '12:30', remarks: 'Family emergency' }],
    });

    expect(result[0]).toMatchObject({ leftAt: '12:30', remarks: 'Family emergency' });
  });
});

describe('StaffAttendanceService teacher read', () => {
  function teacherDb() {
    const { db, service } = makeDb();
    db.teacher.findFirst.mockImplementation(({ where }: any) => {
      if (where?.userId === USER_A) return Promise.resolve({ id: TEACHER_A, userId: USER_A, status: 'ACTIVE' });
      return Promise.resolve(null);
    });
    return { db, service };
  }

  it('returns only the caller teacher rows with a monthly summary', async () => {
    const { db, service } = teacherDb();
    db.staffAttendance.findMany.mockResolvedValue([
      { id: 'r1', teacherId: TEACHER_A, status: 'PRESENT', leftAt: null, attendanceDate: new Date('2026-10-01') },
      { id: 'r2', teacherId: TEACHER_A, status: 'PRESENT', leftAt: '12:30', attendanceDate: new Date('2026-10-02') },
      { id: 'r3', teacherId: TEACHER_A, status: 'LEAVE', leftAt: null, attendanceDate: new Date('2026-10-03') },
    ]);

    const result = await service.listForTeacher(TENANT, USER_A, '2026-10');

    expect(db.staffAttendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teacherId: TEACHER_A }) }),
    );
    expect(result.summary).toEqual({ present: 2, absent: 0, leave: 1 });
    expect(result.entries).toHaveLength(3);
  });

  it('403s a user with no teacher profile', async () => {
    const { db, service } = makeDb();
    db.teacher.findFirst.mockResolvedValue(null);

    await expect(service.listForTeacher(TENANT, 'stranger', '2026-10')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('StaffAttendanceService member entries', () => {
  const MEMBER_A = 'member-a';

  function memberDb() {
    const base = makeDb();
    const db = base.db as any;
    db.tenantMembership = { findFirst: jest.fn() };
    db.staffMemberAttendance = {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    };
    return { ...base, db };
  }

  it('upserts one row per staff member for the date', async () => {
    const { db, service } = memberDb();
    db.tenantMembership.findFirst.mockResolvedValue({ id: 'membership-1' });
    db.staffMemberAttendance.upsert.mockImplementation(({ create }: any) => Promise.resolve({ id: 'm-row-1', ...create }));

    const result = await service.upsertMemberEntries(TENANT, ADMIN_USER, {
      date: '2026-10-01',
      entries: [{ userId: MEMBER_A, status: 'PRESENT' }],
    });

    expect(result).toHaveLength(1);
    expect(db.staffMemberAttendance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_userId_attendanceDate: expect.objectContaining({ userId: MEMBER_A }),
        }),
      }),
    );
  });

  it('rejects a user outside the staff directory', async () => {
    const { db, service } = memberDb();
    db.tenantMembership.findFirst.mockResolvedValue(null);

    await expect(
      service.upsertMemberEntries(TENANT, ADMIN_USER, {
        date: '2026-10-01',
        entries: [{ userId: 'stranger-user', status: 'PRESENT' }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.staffMemberAttendance.upsert).not.toHaveBeenCalled();
  });

  it('rejects leftAt without PRESENT status for members too', async () => {
    const { db, service } = memberDb();
    db.tenantMembership.findFirst.mockResolvedValue({ id: 'membership-1' });

    await expect(
      service.upsertMemberEntries(TENANT, ADMIN_USER, {
        date: '2026-10-01',
        entries: [{ userId: MEMBER_A, status: 'LEAVE', leftAt: '15:00' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.staffMemberAttendance.upsert).not.toHaveBeenCalled();
  });

  it('lists member rows scoped to the tenant and optional filters', async () => {
    const { db, service } = memberDb();
    db.staffMemberAttendance.findMany.mockResolvedValue([
      { id: 'm1', userId: MEMBER_A, status: 'PRESENT', attendanceDate: new Date('2026-10-01') },
    ]);

    const result = await service.listMembers(TENANT, { month: '2026-10' });

    expect(db.staffMemberAttendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT }),
        include: expect.objectContaining({ user: expect.anything() }),
      }),
    );
    expect(result).toHaveLength(1);
  });

  it('validates the userId filter references a real staff member', async () => {
    const { db, service } = memberDb();
    db.tenantMembership.findFirst.mockResolvedValue(null);

    await expect(service.listMembers(TENANT, { userId: 'ghost-user' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
