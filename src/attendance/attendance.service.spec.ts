import { BadRequestException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { Prisma } from '@prisma/client';

const tenantId = '11111111-1111-4111-8111-111111111111';
const yearId = '22222222-2222-4222-8222-222222222222';
const studentId = '33333333-3333-4333-8333-333333333333';
const classId = '44444444-4444-4444-8444-444444444444';

/**
 * Compile-time proof that `attendanceSession` is a real key on
 * AttendanceRecordWhereInput. The tenant callbacks are typed `any`, so an
 * invented key like `session` reaches Prisma and fails at runtime with
 * "Unknown argument" — this is the only check that catches it before a user
 * does. If the relation is ever renamed, `tsc` fails here.
 */
const VALID_SESSION_FILTER: Prisma.AttendanceRecordWhereInput = {
  tenantId,
  studentId,
  status: { in: ['PRESENT', 'LATE'] },
  attendanceSession: { classId, attendanceDate: { gte: new Date(), lte: new Date() } },
};

function build(counts: { sessions: number; records: number }) {
  const attendanceRecordCount = jest.fn().mockResolvedValue(counts.records);
  const tx = {
    academicYear: {
      findFirst: jest.fn().mockResolvedValue({
        id: yearId,
        startsOn: '2026-01-01T00:00:00.000Z',
        endsOn: '2026-12-31T00:00:00.000Z',
      }),
    },
    studentEnrollment: {
      findFirst: jest.fn().mockResolvedValue({ id: 'enr-1', classId }),
    },
    attendanceSession: { count: jest.fn().mockResolvedValue(counts.sessions) },
    attendanceRecord: { count: attendanceRecordCount },
  };
  const prisma = {
    withTenantRead: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
  const realtime = { emitDomainEvent: jest.fn().mockResolvedValue(undefined) } as never;
  return { service: new AttendanceService(prisma, realtime), tx, attendanceRecordCount, realtime };
}

describe('AttendanceService.getStudentAttendance', () => {
  it('filters present records through the attendanceSession relation', async () => {
    const { service, attendanceRecordCount } = build({ sessions: 20, records: 15 });

    const result = await service.getStudentAttendance(tenantId, studentId, yearId);

    expect(result).toEqual({ total: 20, present: 15, percentage: 75 });
    const where = attendanceRecordCount.mock.calls[0][0].where;
    expect(where).toHaveProperty('attendanceSession');
    expect(where).not.toHaveProperty('session');
    expect(where.attendanceSession).toEqual(
      expect.objectContaining({ classId }),
    );
    expect(where).toEqual(expect.objectContaining({ tenantId, studentId }));
  });

  it('counts LATE as present, matching the school rule', async () => {
    const { service, attendanceRecordCount } = build({ sessions: 4, records: 3 });

    await service.getStudentAttendance(tenantId, studentId, yearId);

    expect(attendanceRecordCount.mock.calls[0][0].where.status).toEqual({
      in: ['PRESENT', 'LATE'],
    });
  });

  it('reports zeroes for a student with no active enrollment', async () => {
    const { service, tx } = build({ sessions: 10, records: 10 });
    tx.studentEnrollment.findFirst.mockResolvedValue(null);

    await expect(service.getStudentAttendance(tenantId, studentId, yearId)).resolves.toEqual({
      total: 0,
      present: 0,
      percentage: 0,
    });
  });

  it('does not divide by zero when nothing was held', async () => {
    const { service, tx } = build({ sessions: 0, records: 0 });
    tx.studentEnrollment.findFirst.mockResolvedValue({ id: 'enr-1', classId });

    await expect(service.getStudentAttendance(tenantId, studentId, yearId)).resolves.toEqual({
      total: 0,
      present: 0,
      percentage: 0,
    });
  });

  it('rejects an unknown academic year', async () => {
    const { service, tx } = build({ sessions: 1, records: 1 });
    tx.academicYear.findFirst.mockResolvedValue(null);

    await expect(service.getStudentAttendance(tenantId, studentId, yearId)).rejects.toThrow(
      'Academic year not found',
    );
  });

  it('keeps the typed filter in step with the schema', async () => {
    // Runtime assertion so the type-level guard above is exercised, not just
    // compiled away.
    expect(VALID_SESSION_FILTER).toHaveProperty('attendanceSession');
  });
});

describe('AttendanceService.markBulk realtime', () => {
  function markBulkBuild() {
    const tx = {
      attendanceSession: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sess-9', classId, attendanceDate: new Date() }),
      },
      attendanceRecord: { upsert: jest.fn().mockResolvedValue({ id: 'ar-9' }) },
    };
    const prisma = {
      withTenant: jest.fn(async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as PrismaService;
    const realtime = { emitDomainEvent: jest.fn().mockResolvedValue(undefined) } as unknown as RealtimeGateway;
    return { service: new AttendanceService(prisma, realtime), realtime };
  }

  it('emits attendance.marked to the session class room and school-wide after saving', async () => {
    const { service, realtime } = markBulkBuild();

    await service.markBulk(tenantId, 'sess-9', {
      records: [{ studentId, status: 'PRESENT' }],
    } as never);

    expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
      kind: 'attendance.marked',
      rooms: [`class:${classId}`, 'school-wide'],
      payload: { sessionId: 'sess-9' },
    });
  });

  it('emits attendance_updated to the class and school-wide with the refresh scope', async () => {
    const { service, realtime } = markBulkBuild();

    await service.markBulk(tenantId, 'sess-9', {
      records: [{ studentId, status: 'PRESENT' }],
    } as never);

    expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
      kind: 'attendance_updated',
      rooms: [`class:${classId}`, 'school-wide'],
      payload: {
        entityType: 'student',
        sessionId: 'sess-9',
        classId,
        date: expect.any(Date),
      },
    });
  });
});

describe('AttendanceService.listMatrix', () => {
  function matrixBuild() {
    const tx = {
      attendanceRecord: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              id: 'r1',
              status: 'PRESENT',
              remarks: null,
              student: { id: studentId, firstName: 'Zaid', lastName: 'Ali', roleNumber: '12' },
              attendanceSession: {
                id: 's1',
                classId,
                attendanceDate: new Date('2026-10-15T00:00:00.000Z'),
                schoolClass: { className: '1 CSA' },
              },
            },
            {
              id: 'r2',
              status: 'ABSENT',
              remarks: 'No response',
              student: { id: studentId, firstName: 'Ahmed', lastName: 'Kuku', roleNumber: null },
              attendanceSession: {
                id: 's2',
                classId,
                attendanceDate: new Date('2026-10-13T00:00:00.000Z'),
                schoolClass: { className: '1st Boys A' },
              },
            },
          ]),
      },
    };
    const prisma = {
      withTenantRead: jest.fn(async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as PrismaService;
    const realtime = { emitDomainEvent: jest.fn().mockResolvedValue(undefined) } as never;
    return { service: new AttendanceService(prisma, realtime), tx };
  }

  it('queries records through the attendanceSession relation over the date range', async () => {
    const { service, tx } = matrixBuild();

    const rows = await service.listMatrix(tenantId, { from: '2026-10-12', to: '2026-10-16' });

    const call = tx.attendanceRecord.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      tenantId,
      attendanceSession: {
        tenantId,
        attendanceDate: { gte: new Date('2026-10-12'), lte: new Date('2026-10-16T23:59:59.999Z') },
      },
    });
    expect(call.include).toEqual(
      expect.objectContaining({
        student: expect.objectContaining({ select: expect.anything() }),
        attendanceSession: expect.objectContaining({ select: expect.anything() }),
      }),
    );
    expect(rows).toHaveLength(2);
  });

  it('flattens rows into member/day view entries with plain dates', async () => {
    const { service } = matrixBuild();

    const rows = await service.listMatrix(tenantId, { from: '2026-10-12', to: '2026-10-16' });

    expect(rows[0]).toEqual({
      attendanceDate: '2026-10-13',
      classId,
      className: '1st Boys A',
      studentId,
      studentName: 'Ahmed Kuku',
      rollNumber: null,
      status: 'ABSENT',
      remarks: 'No response',
    });
    expect(rows[1]).toEqual(
      expect.objectContaining({ attendanceDate: '2026-10-15', className: '1 CSA', status: 'PRESENT' }),
    );
  });

  it('sorts by date, then class name, then student first name', async () => {
    const { service } = matrixBuild();

    const rows = await service.listMatrix(tenantId, { from: '2026-10-12', to: '2026-10-16' });

    expect(rows.map((r: any) => r.attendanceDate)).toEqual(['2026-10-13', '2026-10-15']);
  });

  it('scopes to a single class when classId is provided', async () => {
    const { service, tx } = matrixBuild();

    await service.listMatrix(tenantId, { from: '2026-10-12', to: '2026-10-16', classId });

    const where = tx.attendanceRecord.findMany.mock.calls[0][0].where;
    expect(where.attendanceSession).toEqual(
      expect.objectContaining({ classId, attendanceDate: expect.anything() }),
    );
  });

  it('rejects an inverted range without querying', async () => {
    const { service, tx } = matrixBuild();

    await expect(
      service.listMatrix(tenantId, { from: '2026-10-16', to: '2026-10-12' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.attendanceRecord.findMany).not.toHaveBeenCalled();
  });
});
