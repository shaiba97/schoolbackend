import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { StudentsMeService } from './students-me.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const USER_A = 'user-a';
const USER_B = 'user-b';
const STUDENT_A = 'student-a';
const STUDENT_B = 'student-b';
const YEAR_ID = 'year-1';
const CLASS_A = 'class-a';

/**
 * Minimal stand-in for Prisma's Decimal.
 *
 * The service converts money with `Number(value)`, which only works because a
 * real Prisma Decimal exposes `valueOf`. A mock with just `toNumber()` silently
 * yields NaN, so the double is faithful rather than merely convenient.
 */
function dec(n: number): any {
  return { toNumber: () => n, valueOf: () => n, toString: () => String(n) };
}

function makeDb() {
  const db: any = {
    student: { findFirst: jest.fn(), findFirstOrThrow: jest.fn() },
    studentEnrollment: { findFirst: jest.fn() },
    studentGuardian: { findMany: jest.fn().mockResolvedValue([]) },
    academicYear: {
      findFirst: jest.fn().mockResolvedValue({
        id: YEAR_ID,
        name: '2026/27',
        startsOn: new Date('2026-01-01'),
        endsOn: new Date('2026-12-31'),
      }),
    },
    timetableEntry: { findMany: jest.fn().mockResolvedValue([]) },
    examResult: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    classSubject: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    withTenant: jest.fn(async (_t: string, cb: (tx: unknown) => Promise<unknown>) => cb(db)),
    withTenantRead: jest.fn(async (_t: string, cb: (tx: unknown) => Promise<unknown>) => cb(db)),
  } as unknown as PrismaService;
  const jwt = {
    signAsync: jest.fn(async () => 'test-ticket'),
    verifyAsync: jest.fn(),
  } as any;
  const financePortal: any = {
    getStudentLedger: jest.fn(async (_t: string, studentId: string) => ({ ledger: studentId })),
  };
  return {
    db,
    service: new StudentsMeService(prisma, jwt, financePortal as never),
    financePortal,
  };
}

/** Student A resolves; enrollment is ACTIVE in CLASS_A. */
function seedStudentA(db: any, overrides: Record<string, unknown> = {}) {
  db.student.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(
      where.tenantId === TENANT && where.userId === USER_A
        ? { id: STUDENT_A, userId: USER_A, roleNumber: '26S1', status: 'ACTIVE', ...overrides }
        : null,
    ),
  );
  db.studentEnrollment.findFirst.mockResolvedValue({
    id: 'enr-1',
    classId: CLASS_A,
    field: null,
    enrolledOn: new Date('2026-01-10'),
    schoolClass: { id: CLASS_A, className: 'SS1A', grade: 1 },
  });
  db.student.findFirstOrThrow.mockResolvedValue({
    id: STUDENT_A,
    roleNumber: '26S1',
    firstName: 'Ada',
    middleName: null,
    lastName: 'Lovelace',
    gender: 'FEMALE',
    dateOfBirth: new Date('2012-05-04'),
    phone: '+24990000001',
    email: 'ada@example.test',
    photoUrl: null,
    educationLevel: 'SECONDARY',
    grade: 1,
    status: 'ACTIVE',
    admissionDate: new Date('2026-01-10'),
    user: { id: USER_A, email: 'ada@example.test' },
    enrollments: [{ schoolClass: { className: 'SS1A' } }],
  });
}

describe('StudentsMeService identity resolution', () => {
  it('scopes the student lookup by BOTH tenant and the session user', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);

    await service.getProfile(TENANT, USER_A);

    expect(db.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, userId: USER_A } }),
    );
  });

  it('refuses when the session user has no student row in this tenant', async () => {
    const { db, service } = makeDb();
    db.student.findFirst.mockResolvedValue(null);

    await expect(service.getProfile(TENANT, USER_B)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when the student row belongs to a different tenant', async () => {
    const { db, service } = makeDb();
    // The same user id is a real student in OTHER_TENANT and nothing in TENANT.
    db.student.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.tenantId === OTHER_TENANT
          ? { id: STUDENT_B, userId: USER_B, roleNumber: '26S2', status: 'ACTIVE' }
          : null,
      ),
    );
    db.student.findFirstOrThrow.mockResolvedValue({
      id: STUDENT_B,
      roleNumber: '26S2',
      firstName: 'Grace',
      middleName: null,
      lastName: 'Hopper',
      gender: 'FEMALE',
      dateOfBirth: new Date('2012-06-06'),
      phone: null,
      email: null,
      photoUrl: null,
      educationLevel: 'SECONDARY',
      grade: 1,
      status: 'ACTIVE',
      admissionDate: new Date('2026-01-10'),
      user: { id: USER_B, email: null },
    });
    db.studentEnrollment.findFirst.mockResolvedValue({
      id: 'enr-x',
      classId: CLASS_A,
      field: null,
      enrolledOn: new Date('2026-01-10'),
      schoolClass: { id: CLASS_A, className: 'SS1X', grade: 1 },
    });

    // Works in its own tenant...
    await expect(service.getProfile(OTHER_TENANT, USER_B)).resolves.toBeDefined();
    // ...and is invisible in a different one, so tenant scoping is real.
    await expect(service.getProfile(TENANT, USER_B)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a non-ACTIVE student (withdrawn / transferred out)', async () => {
    const { db, service } = makeDb();
    db.student.findFirst.mockResolvedValue({ id: STUDENT_A, userId: USER_A, status: 'WITHDRAWN' });

    await expect(service.getProfile(TENANT, USER_A)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('mints a short-lived socket ticket only for a resolved student', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);

    const result = await service.mintSocketTicket(TENANT, USER_A);

    expect(result).toEqual({ ticket: 'test-ticket', expiresIn: 600 });
  });

  it('refuses a socket ticket when there is no student row', async () => {
    const { db, service } = makeDb();
    db.student.findFirst.mockResolvedValue(null);

    await expect(service.mintSocketTicket(TENANT, USER_B)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('StudentsMeService cross-student isolation', () => {
  it('reads only the session student results â€” never another student id', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);

    await service.getResults(TENANT, USER_A);

    const call = db.examResult.findMany.mock.calls[0][0];
    expect(call.where).toEqual(expect.objectContaining({ tenantId: TENANT, studentId: STUDENT_A }));
    expect(call.where.studentId).not.toBe(STUDENT_B);
  });

  it('reads only the session student attendance', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);

    await service.getAttendance(TENANT, USER_A);

    const call = db.attendanceRecord.findMany.mock.calls[0][0];
    expect(call.where).toEqual(expect.objectContaining({ tenantId: TENANT, studentId: STUDENT_A }));
  });

  it('scopes the timetable to the class from the session enrollment, not a param', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);

    await service.getTimetable(TENANT, USER_A);

    const call = db.timetableEntry.findMany.mock.calls[0][0];
    expect(call.where).toEqual(
      expect.objectContaining({ tenantId: TENANT, classId: CLASS_A, academicYearId: YEAR_ID }),
    );
  });

  it('refuses timetable access when the student has no ACTIVE enrollment', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    db.studentEnrollment.findFirst.mockResolvedValue(null);

    await expect(service.getTimetable(TENANT, USER_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.timetableEntry.findMany).not.toHaveBeenCalled();
  });
});

describe('StudentsMeService results visibility', () => {
  it('only returns results from PUBLISHED exams', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);

    await service.getResults(TENANT, USER_A);

    const call = db.examResult.findMany.mock.calls[0][0];
    expect(call.where.examSubject.exam.status).toBe('PUBLISHED');
  });

  it('averages only scored rows and ignores null marks', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    db.examResult.findMany.mockResolvedValue([
      {
        id: 'r1',
        marks: dec(40),
        grade: 'C',
        status: 'PUBLISHED',
        kind: 'MAJOR',
        createdAt: new Date('2026-03-01'),
        examSubject: {
          id: 'es1',
          maxMarks: dec(50),
          examDate: new Date('2026-03-01'),
          exam: { id: 'e1', name: 'Term 1', examType: { name: 'Exam' } },
          classSubject: {
            subject: { id: 's1', name: 'Mathematics' },
            schoolClass: { className: 'SS1A' },
          },
        },
      },
      {
        id: 'r2',
        marks: null,
        grade: null,
        status: 'PUBLISHED',
        kind: 'MAJOR',
        createdAt: new Date('2026-03-02'),
        examSubject: {
          id: 'es2',
          maxMarks: dec(50),
          examDate: new Date('2026-03-02'),
          exam: { id: 'e1', name: 'Term 1', examType: { name: 'Exam' } },
          classSubject: {
            subject: { id: 's2', name: 'English' },
            schoolClass: { className: 'SS1A' },
          },
        },
      },
    ]);

    const result = await service.getResults(TENANT, USER_A);

    expect(result.averagePercentage).toBe(80);
    expect(result.results[0].percentage).toBe(80);
    expect(result.results[1].percentage).toBeNull();
  });
});

describe('StudentsMeService attendance summary', () => {
  it('counts PRESENT and LATE as attended, matching the academic portal rule', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    db.attendanceRecord.findMany.mockResolvedValue([
      { id: 'a1', status: 'PRESENT', markedAt: new Date(), attendanceSession: { attendanceDate: new Date('2026-03-01'), subject: null, schoolClass: null } },
      { id: 'a2', status: 'LATE', markedAt: new Date(), attendanceSession: { attendanceDate: new Date('2026-03-02'), subject: null, schoolClass: null } },
      { id: 'a3', status: 'ABSENT', markedAt: new Date(), attendanceSession: { attendanceDate: new Date('2026-03-03'), subject: null, schoolClass: null } },
      { id: 'a4', status: 'EXCUSED', markedAt: new Date(), attendanceSession: { attendanceDate: new Date('2026-03-04'), subject: null, schoolClass: null } },
    ]);

    const { summary } = await service.getAttendance(TENANT, USER_A);

    expect(summary.present).toBe(1);
    expect(summary.late).toBe(1);
    expect(summary.absent).toBe(1);
    expect(summary.excused).toBe(1);
    expect(summary.attended).toBe(2);
    expect(summary.total).toBe(4);
    expect(summary.percentage).toBe(50);
  });

  it('returns a null percentage when there is no attendance at all', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    db.attendanceRecord.findMany.mockResolvedValue([]);

    const { summary } = await service.getAttendance(TENANT, USER_A);

    expect(summary.percentage).toBeNull();
    expect(summary.total).toBe(0);
  });
});

describe('StudentsMeService cases scoping', () => {
  it('only reads the session student cases', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    db.studentCase = { findMany: jest.fn().mockResolvedValue([]) };

    await service.getCases(TENANT, USER_A);

    expect(db.studentCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, studentId: STUDENT_A } }),
    );
  });
});

describe('StudentsMeService timetable subjects', () => {
  function seedAssignments(db: any) {
    db.classSubject.findMany.mockResolvedValue([
      {
        id: 'cs-math',
        subject: { id: 's-math', name: 'Mathematics' },
        teacher: { user: { firstName: 'Anas', lastName: 'Elmahi' } },
      },
      {
        id: 'cs-eng',
        subject: { id: 's-eng', name: 'English' },
        teacher: null,
      },
    ]);
  }

  it('lists distinct class subjects with their teachers, scoped to the enrollment class', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    seedAssignments(db);

    const result = await service.getTimetable(TENANT, USER_A);

    expect(db.classSubject.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, classId: CLASS_A }),
        orderBy: { subject: { name: 'asc' } },
      }),
    );
    expect(result.subjects).toEqual(
      expect.arrayContaining([
        { subjectId: 's-eng', subjectName: 'English', teacherName: null },
        { subjectId: 's-math', subjectName: 'Mathematics', teacherName: 'Anas Elmahi' },
      ]),
    );
    expect(result.subjects).toHaveLength(2);
  });

  it('keeps unassigned subjects with a null teacher instead of dropping them', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    seedAssignments(db);

    const result = await service.getTimetable(TENANT, USER_A);

    expect(result.subjects.some((subject) => subject.teacherName === null)).toBe(true);
    expect(result.subjects).toHaveLength(2);
  });
});

describe('StudentsMeService result PDF', () => {
  it('refuses an unpublished exam indistinguishably from a missing one', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    db.exam = { findFirst: jest.fn().mockResolvedValue(null) };

    await expect(service.getResultPdf(TENANT, USER_A, 'exam-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('gates the lookup on PUBLISHED status server-side', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    db.exam = { findFirst: jest.fn().mockResolvedValue(null) };

    await expect(service.getResultPdf(TENANT, USER_A, 'exam-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.exam.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'PUBLISHED' }) }),
    );
  });

  it('renders a slip scoped to the session student', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    db.exam = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'exam-1',
        name: 'Term 1',
        examDate: new Date('2026-03-01'),
        examType: { name: 'Exam' },
      }),
    };
    db.examResult.findMany.mockResolvedValue([
      {
        marks: dec(40),
        grade: 'C',
        examSubject: {
          maxMarks: dec(50),
          classSubject: { subject: { name: 'Mathematics' } },
        },
      },
    ]);

    const { filename, buffer } = await service.getResultPdf(TENANT, USER_A, 'exam-1');

    expect(filename).toContain('26S1');
    expect(filename.endsWith('.pdf')).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    const examCall = db.exam.findFirst.mock.calls[0][0];
    expect(examCall.where).toEqual(
      expect.objectContaining({ id: 'exam-1', tenantId: TENANT, status: 'PUBLISHED' }),
    );
  });
});

describe('StudentsMeService performance trend', () => {
  it('reports improving when the current window beats the prior window', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    const now = Date.now();
    const prior = new Date(now - 40 * 86400000).toISOString().slice(0, 10);
    const recent = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
    db.examResult.findMany.mockResolvedValue([
      { createdAt: new Date(`${prior}T09:00:00Z`), marks: dec(40), examSubject: { maxMarks: dec(50), classSubject: { subject: { name: 'Math' } } } },
      { createdAt: new Date(`${recent}T09:00:00Z`), marks: dec(50), examSubject: { maxMarks: dec(50), classSubject: { subject: { name: 'Math' } } } },
    ]);

    const trend = await service.getPerformanceTrend(TENANT, USER_A, {
      metric: 'results',
      window: 'month',
    });

    expect(trend.current.average).toBe(100);
    expect(trend.previous.average).toBe(80);
    expect(trend.delta).toBe(20);
    expect(trend.verdict).toBe('improving');
  });

  it('reports stable when the movement is under one percentage point', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    const now = Date.now();
    const prior = new Date(now - 40 * 86400000).toISOString().slice(0, 10);
    const recent = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
    db.examResult.findMany.mockResolvedValue([
      { createdAt: new Date(`${prior}T09:00:00Z`), marks: dec(50), examSubject: { maxMarks: dec(50), classSubject: { subject: { name: 'Math' } } } },
      { createdAt: new Date(`${recent}T09:00:00Z`), marks: dec(49.8), examSubject: { maxMarks: dec(50), classSubject: { subject: { name: 'Math' } } } },
    ]);

    const trend = await service.getPerformanceTrend(TENANT, USER_A, {
      metric: 'results',
      window: 'month',
    });

    expect(trend.verdict).toBe('stable');
  });

  it('reports declining when the current window falls behind', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    const now = Date.now();
    const prior = new Date(now - 40 * 86400000).toISOString().slice(0, 10);
    const recent = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
    db.examResult.findMany.mockResolvedValue([
      { createdAt: new Date(`${prior}T09:00:00Z`), marks: dec(45), examSubject: { maxMarks: dec(50), classSubject: { subject: { name: 'Math' } } } },
      { createdAt: new Date(`${recent}T09:00:00Z`), marks: dec(35), examSubject: { maxMarks: dec(50), classSubject: { subject: { name: 'Math' } } } },
    ]);

    const trend = await service.getPerformanceTrend(TENANT, USER_A, {
      metric: 'results',
      window: 'month',
    });

    expect(trend.verdict).toBe('declining');
    expect(trend.delta).toBe(-20);
  });

  it('returns a null verdict when either window has no data', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    db.examResult.findMany.mockResolvedValue([]);

    const trend = await service.getPerformanceTrend(TENANT, USER_A, {
      metric: 'results',
      window: 'month',
    });

    expect(trend.delta).toBeNull();
    expect(trend.verdict).toBeNull();
  });

  it('splits the current window average into Test and Exam buckets', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    const now = Date.now();
    const recent = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
    db.examResult.findMany.mockResolvedValue([
      {
        createdAt: new Date(`${recent}T09:00:00Z`),
        marks: dec(90),
        examSubject: {
          maxMarks: dec(100),
          exam: { examType: { name: 'Test' } },
          classSubject: { subject: { name: 'Math' } },
        },
      },
      {
        createdAt: new Date(`${recent}T09:00:00Z`),
        marks: dec(70),
        examSubject: {
          maxMarks: dec(100),
          exam: { examType: { name: 'Exam' } },
          classSubject: { subject: { name: 'Math' } },
        },
      },
    ]);

    const trend = await service.getPerformanceTrend(TENANT, USER_A, {
      metric: 'results',
      window: 'month',
    });

    expect(trend.byType.test).toEqual({ average: 90, samples: 1 });
    expect(trend.byType.exam).toEqual({ average: 70, samples: 1 });
  });

  it('counts untyped results in the Exam bucket', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    const now = Date.now();
    const recent = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
    db.examResult.findMany.mockResolvedValue([
      {
        createdAt: new Date(`${recent}T09:00:00Z`),
        marks: dec(80),
        examSubject: {
          maxMarks: dec(100),
          exam: null,
          classSubject: { subject: { name: 'Math' } },
        },
      },
    ]);

    const trend = await service.getPerformanceTrend(TENANT, USER_A, {
      metric: 'results',
      window: 'month',
    });

    expect(trend.byType.test).toEqual({ average: null, samples: 0 });
    expect(trend.byType.exam).toEqual({ average: 80, samples: 1 });
  });

  it('scales attendance 0/1 records to a percentage in the same 0-100 units as results', async () => {
    const { db, service } = makeDb();
    seedStudentA(db);
    const now = Date.now();
    const recent = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
    db.attendanceRecord.findMany.mockResolvedValue([
      { status: 'PRESENT', attendanceSession: { attendanceDate: new Date(`${recent}T00:00:00Z`) } },
      { status: 'ABSENT', attendanceSession: { attendanceDate: new Date(`${recent}T00:00:00Z`) } },
    ]);

    const trend = await service.getPerformanceTrend(TENANT, USER_A, {
      metric: 'attendance',
      window: 'week',
    });

    expect(trend.current.average).toBe(50);
  });
});

describe('StudentsMeService — self finance', () => {
  it("returns the ledger of the caller's own student via the finance portal", async () => {
    const { db, service, financePortal } = makeDb();
    seedStudentA(db);
    financePortal.getStudentLedger.mockResolvedValue({ totals: { balance: 0 } });

    const out: any = await service.getFinance(TENANT, USER_A);

    expect(financePortal.getStudentLedger).toHaveBeenCalledWith(TENANT, STUDENT_A);
    expect(out.totals.balance).toBe(0);
  });

  it('403s without a student profile and never touches the ledger', async () => {
    const { db, service, financePortal } = makeDb();
    db.student.findFirst.mockResolvedValue(null);

    await expect(service.getFinance(TENANT, USER_A)).rejects.toThrow(/no student profile/i);
    expect(financePortal.getStudentLedger).not.toHaveBeenCalled();
  });

  it('is scoped by tenant', async () => {
    const { db, service, financePortal } = makeDb();
    seedStudentA(db);

    await expect(service.getFinance(OTHER_TENANT, USER_A)).rejects.toThrow(/no student profile/i);
    expect(financePortal.getStudentLedger).not.toHaveBeenCalled();
  });
});