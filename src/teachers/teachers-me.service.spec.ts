import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TeachersMeService } from './teachers-me.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ExamsService } from '../exams/exams.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Unit tests for the teacher self-service scoping rules. The Prisma handle is
 * mocked, so these verify the access-control logic (who may read/write what),
 * not the query shapes.
 */

type ModelMock = Record<string, jest.Mock>;
type DeepMock = Record<string, ModelMock> & {
  withTenant: jest.Mock;
  withTenantRead: jest.Mock;
};

function makeDb(): DeepMock {
  const store = {} as DeepMock;
  const modelNames = [
    'teacher',
    'classSubject',
    'academicYear',
    'timetableEntry',
    'attendanceSession',
    'attendanceRecord',
    'studentEnrollment',
    'examSubject',
    'examResult',
    'exam',
    'membershipRole',
    'notification',
    'schoolClass',
    'student',
  ];
  for (const model of modelNames) {
    store[model] = {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
  }
  // Unit tests run the transaction callbacks directly against the same mock.
  store.withTenant = jest.fn((_tenantId: string, fn: (db: any) => unknown) => fn(store));
  store.withTenantRead = jest.fn((_tenantId: string, fn: (db: any) => unknown) => fn(store));
  return store;
}

const TENANT = 'tenant-1';
const TEACHER_A_USER = 'user-a';
const TEACHER_B_USER = 'user-b';
const TEACHER_A = 'teacher-a';
const TEACHER_B = 'teacher-b';

async function makeService(db: DeepMock) {
  const realtime = { emitDomainEvent: jest.fn().mockResolvedValue(undefined) };
  const exams = { applyReleaseRule: jest.fn().mockResolvedValue(undefined) };
  const notifications = { notifyUsers: jest.fn().mockResolvedValue({ notified: 1 }) };
  const jwt = {
    signAsync: jest.fn(async () => 'test-ticket'),
    verifyAsync: jest.fn(),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TeachersMeService,
      { provide: PrismaService, useValue: db as unknown as PrismaService },
      { provide: RealtimeGateway, useValue: realtime },
      { provide: ExamsService, useValue: exams },
      { provide: NotificationsService, useValue: notifications },
      { provide: JwtService, useValue: jwt },
    ],
  }).compile();

  return { service: module.get(TeachersMeService), realtime, exams, notifications, jwt };
}

/** teacher.findFirst used by resolveTeacher: route per userId. */
function mockTeacherProfiles(db: DeepMock) {
  db.teacher.findFirst.mockImplementation(({ where }: any) => {
    if (where?.userId === TEACHER_A_USER) {
      return Promise.resolve({ id: TEACHER_A, userId: TEACHER_A_USER, status: 'ACTIVE' });
    }
    if (where?.userId === TEACHER_B_USER) {
      return Promise.resolve({ id: TEACHER_B, userId: TEACHER_B_USER, status: 'ACTIVE' });
    }
    return Promise.resolve(null);
  });
}

/** academicYear.findFirst for currentYear(). */
function mockCurrentYear(db: DeepMock) {
  db.academicYear.findFirst.mockResolvedValue({ id: 'year-1', name: '2026' });
}

/** classSubject.findMany for myClassSubjectIds / listClasses: A teaches class-1, B teaches class-2. */
function mockAssignments(db: DeepMock) {
  db.classSubject.findMany.mockImplementation(({ where }: any) => {
    if (where?.teacherId === TEACHER_A) {
      return Promise.resolve([
        { classId: 'class-1' },
        { classId: 'class-1' },
      ]);
    }
    if (where?.teacherId === TEACHER_B) {
      return Promise.resolve([{ classId: 'class-2' }]);
    }
    return Promise.resolve([]);
  });
}

describe('TeachersMeService — scoping', () => {
  let db: DeepMock;
  let service: TeachersMeService;
  let realtime: { emitDomainEvent: jest.Mock };
  let exams: { applyReleaseRule: jest.Mock };
  let notifications: { notifyUsers: jest.Mock };
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };

  beforeEach(async () => {
    db = makeDb();
    mockTeacherProfiles(db);
    mockCurrentYear(db);
    mockAssignments(db);
    ({ service, realtime, exams, notifications, jwt } = await makeService(db));
  });

  describe('getClassDetail / class ownership', () => {
    it('rejects a class the teacher does not teach (403, even though it exists)', async () => {
      db.classSubject.findFirst.mockResolvedValue(null);
      await expect(
        service.getClassDetail(TENANT, TEACHER_A_USER, 'class-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns my subjects + roster for my own class', async () => {
      db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
      db.classSubject.findMany.mockResolvedValue([
        {
          id: 'cs-1',
          subject: { id: 'subj-1', name: 'Mathematics' },
          schoolClass: { id: 'class-1', className: 'Grade 6' },
        },
      ]);
      db.schoolClass.findFirst.mockResolvedValue({
        id: 'class-1',
        className: 'Grade 6',
        educationLevel: 'INTERMEDIATE',
        grade: 'SIXTH',
        track: null,
        capacity: 30,
      });
      db.studentEnrollment.findMany.mockResolvedValue([
        {
          enrollmentId: 'e-1',
          student: { id: 's-1', roleNumber: '101', firstName: 'Adam', lastName: 'One' },
        },
      ]);
      db.timetableEntry.findMany.mockResolvedValue([]);

      const detail = await service.getClassDetail(TENANT, TEACHER_A_USER, 'class-1');
      expect(detail.mySubjects).toHaveLength(1);
      expect(detail.mySubjects[0].subjectName).toBe('Mathematics');
      expect(detail.students).toHaveLength(1);
      expect(detail.students[0].student.id).toBe('s-1');
    });
  });

  describe('attendance edit window', () => {
    // Local-calendar keys: the window compares server-local days, so fixtures
    // must be built from local components (UTC slices drift near midnight).
    function localKey(date: Date): string {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function isoDaysAgo(days: number): string {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return localKey(d);
    }

    it('refuses marking a session from yesterday (same-day window only)', async () => {
      db.attendanceSession.findFirst.mockResolvedValue({
        id: 'sess-1',
        classId: 'class-1',
        attendanceDate: new Date(`${isoDaysAgo(1)}T00:00:00.000Z`),
      });
      db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });

      await expect(
        service.markAttendanceSession(TENANT, TEACHER_A_USER, 'sess-1', [
          { studentId: 's-1', status: 'PRESENT' },
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses marking a future session', async () => {
      db.attendanceSession.findFirst.mockResolvedValue({
        id: 'sess-1',
        classId: 'class-1',
        attendanceDate: new Date(`${isoDaysAgo(-3)}T00:00:00.000Z`),
      });
      db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });

      await expect(
        service.markAttendanceSession(TENANT, TEACHER_A_USER, 'sess-1', [
          { studentId: 's-1', status: 'PRESENT' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses creating a session for a class I do not teach', async () => {
      db.classSubject.findFirst.mockResolvedValue(null);
      await expect(
        service.createAttendanceSession(TENANT, TEACHER_A_USER, {
          classId: 'class-2',
          periodNo: 4,
          date: isoDaysAgo(0),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses creating a session when one already exists for that period', async () => {
      const day = isoDaysAgo(0);
      db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
      db.timetableEntry.findMany.mockResolvedValue([
        {
          classId: 'class-1',
          dayOfWeek: weekdayOf(day),
          periodNo: 4,
          startTime: '09:50',
          endTime: '10:40',
          subjectId: 'subj-1',
          subject: { id: 'subj-1', name: 'Mathematics' },
        },
      ]);
      db.attendanceSession.findFirst.mockResolvedValue({ id: 'sess-x' });
      await expect(
        service.createAttendanceSession(TENANT, TEACHER_A_USER, {
          classId: 'class-1',
          periodNo: 4,
          date: day,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    function weekdayOf(dateStr: string): string {
      return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(`${dateStr}T12:00:00`).getDay()];
    }

    describe('per-period sessions', () => {
      function periodEntry(day: string, periodNo: number, subjectId = 'subj-1') {
        return {
          classId: 'class-1',
          dayOfWeek: weekdayOf(day),
          periodNo,
          startTime: '07:00',
          endTime: '07:50',
          subjectId,
          subject: { id: subjectId, name: 'Mathematics' },
        };
      }

      it('creates a session keyed to the timetable period with the derived subject', async () => {
        const day = isoDaysAgo(0);
        db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
        db.timetableEntry.findMany.mockResolvedValue([periodEntry(day, 4)]);
        db.attendanceSession.findFirst.mockResolvedValue(null);
        db.attendanceSession.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'sess-new', ...data }));

        const result = await service.createAttendanceSession(TENANT, TEACHER_A_USER, {
          classId: 'class-1',
          periodNo: 4,
          date: day,
        });

        expect(db.attendanceSession.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              classId: 'class-1',
              subjectId: 'subj-1',
              sessionNumber: 4,
            }),
          }),
        );
        expect(result).toMatchObject({ id: 'sess-new' });
      });

      it('rejects a period the teacher does not teach that day', async () => {
        const day = isoDaysAgo(0);
        db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
        db.timetableEntry.findMany.mockResolvedValue([periodEntry(day, 2)]);

        await expect(
          service.createAttendanceSession(TENANT, TEACHER_A_USER, {
            classId: 'class-1',
            periodNo: 4,
            date: day,
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('lists one row per period plus a legacy whole-day row', async () => {
        const day = isoDaysAgo(0);
        const dow = weekdayOf(day);
        db.timetableEntry.findMany.mockResolvedValue([
          { classId: 'class-1', dayOfWeek: dow, periodNo: 1, startTime: '07:00', endTime: '07:50', subjectId: 'subj-1', subject: { id: 'subj-1', name: 'Mathematics' }, schoolClass: { id: 'class-1', className: 'Grade 1' } },
          { classId: 'class-1', dayOfWeek: dow, periodNo: 2, startTime: '07:50', endTime: '08:40', subjectId: 'subj-1', subject: { id: 'subj-1', name: 'Mathematics' }, schoolClass: { id: 'class-1', className: 'Grade 1' } },
        ]);
        db.attendanceSession.findMany.mockResolvedValue([
          { id: 'sess-1', classId: 'class-1', subjectId: 'subj-1', sessionNumber: 1, attendanceDate: new Date(`${day}T00:00:00.000Z`), _count: { records: 2 } },
          { id: 'sess-old', classId: 'class-1', subjectId: null, sessionNumber: 1, attendanceDate: new Date(`${day}T00:00:00.000Z`), _count: { records: 5 } },
        ]);
        db.studentEnrollment.groupBy.mockResolvedValue([{ classId: 'class-1', _count: { _all: 2 } }]);

        const result = await service.listAttendanceSessions(TENANT, TEACHER_A_USER, day);

        expect(result.rows).toHaveLength(3);
        expect(result.rows[0]).toMatchObject({ classId: 'class-1', periodNo: 1, subjectId: 'subj-1', subjectName: 'Mathematics', session: expect.objectContaining({ id: 'sess-1' }) });
        expect(result.rows[1]).toMatchObject({ classId: 'class-1', periodNo: 2, session: null });
        expect(result.rows[2]).toMatchObject({ classId: 'class-1', periodNo: null, session: expect.objectContaining({ id: 'sess-old' }) });
      });

      it('allows the same class and day in a different period', async () => {
        const day = isoDaysAgo(0);
        db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
        db.timetableEntry.findMany.mockResolvedValue([periodEntry(day, 2), periodEntry(day, 5, 'subj-2')]);
        db.attendanceSession.findFirst.mockResolvedValue(null);
        db.attendanceSession.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'sess-5', ...data }));

        const result = await service.createAttendanceSession(TENANT, TEACHER_A_USER, {
          classId: 'class-1',
          periodNo: 5,
          date: day,
        });

        expect(db.attendanceSession.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ subjectId: 'subj-2', sessionNumber: 5 }),
          }),
        );
        expect(result).toMatchObject({ id: 'sess-5' });
      });
    });

    it('marks a today-session for my own class and validates the roster', async () => {
      const now = new Date();
      const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      db.attendanceSession.findFirst.mockResolvedValue({
        id: 'sess-1',
        classId: 'class-1',
        attendanceDate: new Date(`${todayLocal}T00:00:00.000Z`),
      });
      db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
      db.academicYear.findFirst.mockResolvedValue({ id: 'year-1' });
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-1' }, { studentId: 's-2' }]);
      db.attendanceRecord.upsert.mockResolvedValue({ id: 'r-1' });

      const result = await service.markAttendanceSession(TENANT, TEACHER_A_USER, 'sess-1', [
        { studentId: 's-1', status: 'PRESENT' },
        { studentId: 's-2', status: 'ABSENT', remarks: 'sick' },
      ]);
      expect(result).toEqual({ saved: 2 });
      expect(db.attendanceRecord.upsert).toHaveBeenCalledTimes(2);
    });

    it('rejects marking students outside the class roster', async () => {
      const now = new Date();
      const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      db.attendanceSession.findFirst.mockResolvedValue({
        id: 'sess-1',
        classId: 'class-1',
        attendanceDate: new Date(`${todayLocal}T00:00:00.000Z`),
      });
      db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
      db.academicYear.findFirst.mockResolvedValue({ id: 'year-1' });
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-1' }]);

      await expect(
        service.markAttendanceSession(TENANT, TEACHER_A_USER, 'sess-1', [
          { studentId: 's-999', status: 'PRESENT' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('exam visibility between two teachers', () => {
    it('a non-author, non-assigned teacher cannot open the exam detail', async () => {
      db.exam.findFirst.mockResolvedValue({
        id: 'exam-1',
        authorId: TEACHER_A_USER, // authored by A
        academicYearId: 'year-1',
        _count: { examRoomAssignments: 0 },
        author: null,
        examType: null,
        term: null,
        examSubjects: [
          {
            id: 'es-1',
            maxMarks: 100,
            passingMarks: null,
            gradingScale: null,
            classSubject: {
              id: 'cs-1',
              teacherId: TEACHER_A, // taught by A
              classId: 'class-1',
              subject: { id: 'subj-1', name: 'Math' },
              schoolClass: { id: 'class-1', className: 'Grade 6' },
            },
            results: [],
          },
        ],
      });

      await expect(
        service.getExamDetail(TENANT, TEACHER_B_USER, 'exam-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('an assigned subject teacher sees only their own subject rows', async () => {
      db.exam.findFirst.mockResolvedValue({
        id: 'exam-1',
        authorId: 'someone-else',
        academicYearId: 'year-1',
        _count: { examRoomAssignments: 0 },
        author: { id: 'someone-else', firstName: 'Exam', lastName: 'Center' },
        examType: null,
        term: null,
        examSubjects: [
          {
            id: 'es-mine',
            maxMarks: { toNumber: () => 100 },
            passingMarks: null,
            gradingScale: null,
            classSubject: {
              id: 'cs-b',
              teacherId: TEACHER_B, // B's subject
              classId: 'class-2',
              subject: { id: 'subj-2', name: 'Physics' },
              schoolClass: { id: 'class-2', className: 'Grade 7' },
            },
            results: [],
          },
          {
            id: 'es-other',
            maxMarks: { toNumber: () => 50 },
            passingMarks: null,
            gradingScale: null,
            classSubject: {
              id: 'cs-a',
              teacherId: TEACHER_A, // A's subject — must not leak
              classId: 'class-1',
              subject: { id: 'subj-1', name: 'Math' },
              schoolClass: { id: 'class-1', className: 'Grade 6' },
            },
            results: [],
          },
        ],
      });
      db.studentEnrollment.findMany.mockResolvedValue([
        { student: { id: 's-2', roleNumber: '201', firstName: 'Bea', lastName: 'Two' } },
      ]);

      const detail = await service.getExamDetail(TENANT, TEACHER_B_USER, 'exam-1');
      expect(detail.subjects).toHaveLength(1);
      expect(detail.subjects[0].examSubjectId).toBe('es-mine');
      expect(detail.subjects[0].subjectName).toBe('Physics');
    });

    it('returns the sample key so an attached sample shows instead of "not attached"', async () => {
      db.exam.findFirst.mockResolvedValue({
        id: 'exam-1',
        authorId: TEACHER_A_USER, // authored by A
        academicYearId: 'year-1',
        sampleObjectKey: 'exams/tenant-1/exam-1/EXAM_SAMPLE/sample.pdf',
        _count: { examRoomAssignments: 0 },
        author: { id: TEACHER_A_USER, firstName: 'Ay', lastName: 'Bee' },
        examType: null,
        term: null,
        examSubjects: [],
      });
      db.studentEnrollment.findMany.mockResolvedValue([]);

      const detail = await service.getExamDetail(
        TENANT,
        TEACHER_A_USER,
        'exam-1',
      );
      expect(detail.sampleObjectKey).toBe(
        'exams/tenant-1/exam-1/EXAM_SAMPLE/sample.pdf',
      );
    });

    it('returns a null sample key when no sample is attached', async () => {
      db.exam.findFirst.mockResolvedValue({
        id: 'exam-1',
        authorId: TEACHER_A_USER, // authored by A
        academicYearId: 'year-1',
        sampleObjectKey: null,
        _count: { examRoomAssignments: 0 },
        author: { id: TEACHER_A_USER, firstName: 'Ay', lastName: 'Bee' },
        examType: null,
        term: null,
        examSubjects: [],
      });
      db.studentEnrollment.findMany.mockResolvedValue([]);

      const detail = await service.getExamDetail(TENANT, TEACHER_A_USER, 'exam-1');
      expect(detail.sampleObjectKey).toBeNull();
    });
  });

  describe('marks entry', () => {
    it('rejects a teacher who neither authored the exam nor teaches the subject', async () => {
      db.examSubject.findFirst.mockResolvedValue({
        id: 'es-1',
        maxMarks: { toNumber: () => 100 },
        exam: { id: 'exam-1', authorId: 'someone-else', academicYearId: 'year-1' },
        classSubject: { id: 'cs-1', teacherId: TEACHER_A, classId: 'class-1' },
        gradingScale: null,
      });

      await expect(
        service.enterMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1', [
          { studentId: 's-2', marks: 90 },
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows the assigned subject teacher and clamps grades via the scale', async () => {
      db.examSubject.findFirst.mockResolvedValue({
        id: 'es-1',
        maxMarks: { toNumber: () => 100 },
        exam: { id: 'exam-1', authorId: 'someone-else', academicYearId: 'year-1' },
        classSubject: { id: 'cs-b', teacherId: TEACHER_B, classId: 'class-2' },
        gradingScale: {
          bands: [
            { grade: 'A', minPercent: { toNumber: () => 90 }, maxPercent: { toNumber: () => 100 } },
            { grade: 'B', minPercent: { toNumber: () => 80 }, maxPercent: { toNumber: () => 89.99 } },
          ],
        },
      });
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-2' }]);
      db.examResult.upsert.mockResolvedValue({ id: 'r-1' });

      await service.enterMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1', [
        { studentId: 's-2', marks: 95 },
      ]);
      expect(db.examResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { examSubjectId_studentId: { examSubjectId: 'es-1', studentId: 's-2' } },
          create: expect.objectContaining({ marks: 95, grade: 'A', submittedBy: TEACHER_B_USER }),
        }),
      );
    });

    it('feeds the saved exam (status + type) to the shared release rule', async () => {
      db.examSubject.findFirst.mockResolvedValue({
        id: 'es-1',
        maxMarks: { toNumber: () => 100 },
        exam: {
          id: 'exam-1',
          authorId: 'someone-else',
          academicYearId: 'year-1',
          status: 'DRAFT',
          examType: { name: 'Test' },
        },
        classSubject: { id: 'cs-b', teacherId: TEACHER_B, classId: 'class-2' },
        gradingScale: null,
      });
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-2' }]);
      db.examResult.upsert.mockResolvedValue({ id: 'r-1' });

      await service.enterMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1', [
        { studentId: 's-2', marks: 80 },
      ]);

      expect(exams.applyReleaseRule).toHaveBeenCalledWith(
        db,
        TENANT,
        expect.objectContaining({
          id: 'exam-1',
          status: 'DRAFT',
          examType: { name: 'Test' },
        }),
      );
    });

    it('rejects marks above the subject maximum', async () => {
      db.examSubject.findFirst.mockResolvedValue({
        id: 'es-1',
        maxMarks: { toNumber: () => 20 },
        exam: { id: 'exam-1', authorId: 'someone-else', academicYearId: 'year-1' },
        classSubject: { id: 'cs-b', teacherId: TEACHER_B, classId: 'class-2' },
        gradingScale: null,
      });
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-2' }]);

      await expect(
        service.enterMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1', [
          { studentId: 's-2', marks: 25 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects marking students outside the class roster', async () => {
      db.examSubject.findFirst.mockResolvedValue({
        id: 'es-1',
        maxMarks: { toNumber: () => 100 },
        exam: { id: 'exam-1', authorId: 'someone-else', academicYearId: 'year-1' },
        classSubject: { id: 'cs-b', teacherId: TEACHER_B, classId: 'class-2' },
        gradingScale: null,
      });
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-2' }]);

      await expect(
        service.enterMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1', [
          { studentId: 's-999', marks: 50 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects edits once the subject is submitted and locked', async () => {
      db.examSubject.findFirst.mockResolvedValue({
        id: 'es-1',
        maxMarks: { toNumber: () => 100 },
        exam: { id: 'exam-1', authorId: 'someone-else', academicYearId: 'year-1' },
        classSubject: { id: 'cs-b', teacherId: TEACHER_B, classId: 'class-2' },
        gradingScale: null,
      });
      db.examResult.findMany.mockResolvedValue([{ status: 'SUBMITTED' }]);

      await expect(
        service.enterMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1', [
          { studentId: 's-2', marks: 90 },
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.examResult.upsert).not.toHaveBeenCalled();
    });
  });

  describe('marks submit handoff', () => {
    function submittedSubject(overrides: Record<string, unknown> = {}) {
      return {
        id: 'es-1',
        exam: {
          id: 'exam-1',
          name: 'Midterm',
          authorId: 'someone-else',
          academicYearId: 'year-1',
          status: 'MARKS_OPEN',
        },
        classSubject: {
          id: 'cs-b',
          teacherId: TEACHER_B,
          classId: 'class-2',
          subject: { name: 'Physics' },
          schoolClass: { id: 'class-2', className: 'Grade 7', classTeacherId: 'teacher-supa' },
        },
        ...overrides,
      };
    }

    function mockSupervisorProfiles(db: DeepMock) {
      db.teacher.findFirst.mockImplementation(({ where }: any) => {
        if (where?.userId === TEACHER_B_USER) {
          return Promise.resolve({ id: TEACHER_B, userId: TEACHER_B_USER, status: 'ACTIVE' });
        }
        if (where?.id === 'teacher-supa') {
          return Promise.resolve({ id: 'teacher-supa', userId: 'supa-user' });
        }
        return Promise.resolve(null);
      });
    }

    it('flips DRAFT rows to SUBMITTED and notifies the supervisor', async () => {
      db.examSubject.findFirst.mockResolvedValue(submittedSubject());
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-2' }]);
      db.examResult.findMany.mockResolvedValue([{ studentId: 's-2' }]);
      db.examResult.updateMany.mockResolvedValue({ count: 1 });
      mockSupervisorProfiles(db);

      const result = await service.submitSubjectMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1');

      expect(result).toEqual({ submitted: 1 });
      expect(db.examResult.updateMany).toHaveBeenCalledWith({
        where: { examSubjectId: 'es-1', tenantId: TENANT, status: 'DRAFT' },
        data: { status: 'SUBMITTED' },
      });
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        TENANT,
        ['supa-user'],
        'Marks submitted for review',
        expect.stringContaining('Physics'),
        'MARKS_SUBMITTED',
      );
    });

    it('rejects submission while roster students are unmarked', async () => {
      db.examSubject.findFirst.mockResolvedValue(submittedSubject());
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-2' }, { studentId: 's-3' }]);
      db.examResult.findMany.mockResolvedValue([{ studentId: 's-2' }]);

      await expect(
        service.submitSubjectMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(db.examResult.updateMany).not.toHaveBeenCalled();
    });

    it('rejects submission by a teacher with no link to the subject', async () => {
      db.examSubject.findFirst.mockResolvedValue(
        submittedSubject({
          exam: {
            id: 'exam-1',
            name: 'Midterm',
            authorId: 'someone-else',
            academicYearId: 'year-1',
            status: 'MARKS_OPEN',
          },
          classSubject: {
            id: 'cs-a',
            teacherId: TEACHER_A,
            classId: 'class-1',
            subject: { name: 'Math' },
            schoolClass: { id: 'class-1', className: 'Grade 6', classTeacherId: null },
          },
        }),
      );

      await expect(
        service.submitSubjectMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects submission for an already published exam', async () => {
      db.examSubject.findFirst.mockResolvedValue(
        submittedSubject({
          exam: {
            id: 'exam-1',
            name: 'Midterm',
            authorId: 'someone-else',
            academicYearId: 'year-1',
            status: 'PUBLISHED',
          },
        }),
      );

      await expect(
        service.submitSubjectMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('supervisor review', () => {
    function supervisedClass() {
      db.schoolClass.findFirst.mockResolvedValue({
        id: 'class-2',
        className: 'Grade 7',
        classTeacherId: TEACHER_B,
      });
    }

    function completeSubject() {
      return {
        id: 'es-1',
        results: [{ studentId: 's-2', marks: 80, status: 'SUBMITTED' }],
        classSubject: { subject: { name: 'Physics' } },
      };
    }

    it('approves a fully submitted class exam to MODERATION and notifies academics', async () => {
      supervisedClass();
      db.exam.findFirst.mockResolvedValue({
        id: 'exam-1',
        name: 'Midterm',
        status: 'MARKS_OPEN',
        academicYearId: 'year-1',
      });
      db.examSubject.findMany.mockResolvedValue([completeSubject()]);
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-2' }]);
      db.exam.update.mockResolvedValue({ id: 'exam-1' });
      db.membershipRole.findMany.mockResolvedValue([
        { membership: { userId: 'acad-1' } },
        { membership: { userId: 'acad-1' } },
      ]);

      const result = await service.approveClassExam(TENANT, TEACHER_B_USER, 'exam-1', 'class-2');

      expect(result).toEqual({ approved: true });
      expect(db.exam.update).toHaveBeenCalledWith({
        where: { id: 'exam-1' },
        data: { status: 'MODERATION' },
      });
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        TENANT,
        ['acad-1'],
        'Marks ready to publish',
        expect.stringContaining('Midterm'),
        'MARKS_APPROVED',
      );
    });

    it('rejects approval by a teacher who does not supervise the class', async () => {
      db.schoolClass.findFirst.mockResolvedValue({
        id: 'class-2',
        className: 'Grade 7',
        classTeacherId: 'teacher-other',
      });

      await expect(
        service.approveClassExam(TENANT, TEACHER_B_USER, 'exam-1', 'class-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects approval while rows are still unsubmitted', async () => {
      supervisedClass();
      db.exam.findFirst.mockResolvedValue({
        id: 'exam-1',
        name: 'Midterm',
        status: 'MARKS_OPEN',
        academicYearId: 'year-1',
      });
      db.examSubject.findMany.mockResolvedValue([
        {
          id: 'es-1',
          results: [{ studentId: 's-2', marks: 80, status: 'DRAFT' }],
          classSubject: { subject: { name: 'Physics' } },
        },
      ]);
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-2' }]);

      await expect(
        service.approveClassExam(TENANT, TEACHER_B_USER, 'exam-1', 'class-2'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.exam.update).not.toHaveBeenCalled();
    });

    it('returns marks to draft with a reason and reopens the exam', async () => {
      db.schoolClass.findFirst.mockResolvedValue({
        id: 'class-2',
        className: 'Grade 7',
        classTeacherId: TEACHER_B,
      });
      db.examSubject.findFirst.mockResolvedValue({
        id: 'es-1',
        exam: { id: 'exam-1', name: 'Midterm', authorId: 'author-u', status: 'MODERATION' },
        classSubject: {
          id: 'cs-b',
          teacherId: TEACHER_B,
          classId: 'class-2',
          subject: { name: 'Physics' },
        },
      });
      db.teacher.findFirst.mockImplementation(({ where }: any) => {
        if (where?.userId === TEACHER_B_USER) {
          return Promise.resolve({ id: TEACHER_B, userId: TEACHER_B_USER, status: 'ACTIVE' });
        }
        if (where?.id === TEACHER_B) {
          return Promise.resolve({
            id: TEACHER_B,
            userId: TEACHER_B_USER,
            user: { firstName: 'Bea', lastName: 'Two' },
          });
        }
        return Promise.resolve(null);
      });
      db.examResult.updateMany.mockResolvedValue({ count: 1 });
      db.exam.update.mockResolvedValue({ id: 'exam-1' });

      const result = await service.returnSubjectMarks(
        TENANT,
        TEACHER_B_USER,
        'class-2',
        'es-1',
        'Recheck question 3',
      );

      expect(result).toEqual({ returned: 1 });
      expect(db.examResult.updateMany).toHaveBeenCalledWith(
        {
          where: { examSubjectId: 'es-1', tenantId: TENANT, status: 'SUBMITTED' },
          data: {
            status: 'DRAFT',
            moderationNote: 'Recheck question 3',
            moderatedByName: 'Bea Two',
          },
        },
      );
      expect(db.exam.update).toHaveBeenCalledWith({
        where: { id: 'exam-1' },
        data: { status: 'MARKS_OPEN' },
      });
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        TENANT,
        ['author-u'],
        'Marks returned to draft',
        expect.stringContaining('Recheck question 3'),
        'MARKS_RETURNED',
      );
    });

    it('shows a supervisor every subject of their supervised class', async () => {
      db.schoolClass.findMany.mockResolvedValue([{ id: 'class-2' }]);
      db.exam.findFirst.mockResolvedValue({
        id: 'exam-1',
        authorId: 'someone-else',
        academicYearId: 'year-1',
        _count: { examRoomAssignments: 0 },
        author: null,
        examType: null,
        term: null,
        examSubjects: [
          {
            id: 'es-mine',
            maxMarks: { toNumber: () => 100 },
            passingMarks: null,
            gradingScale: null,
            classSubject: {
              id: 'cs-b',
              teacherId: TEACHER_B,
              classId: 'class-2',
              subject: { id: 'subj-2', name: 'Physics' },
              schoolClass: { id: 'class-2', className: 'Grade 7' },
            },
            results: [],
          },
          {
            id: 'es-other',
            maxMarks: { toNumber: () => 50 },
            passingMarks: null,
            gradingScale: null,
            classSubject: {
              id: 'cs-a',
              teacherId: TEACHER_A,
              classId: 'class-2',
              subject: { id: 'subj-1', name: 'Math' },
              schoolClass: { id: 'class-2', className: 'Grade 7' },
            },
            results: [],
          },
        ],
      });
      db.studentEnrollment.findMany.mockResolvedValue([]);

      const detail = await service.getExamDetail(TENANT, TEACHER_B_USER, 'exam-1');
      expect(detail.subjects).toHaveLength(2);
    });

    it('lists supervised classes with pending exams and readiness', async () => {
      db.schoolClass.findMany.mockResolvedValue([{ id: 'class-2', className: 'Grade 7' }]);
      db.examSubject.findMany.mockResolvedValue([
        {
          id: 'es-1',
          exam: {
            id: 'exam-1',
            name: 'Midterm',
            status: 'MARKS_OPEN',
            academicYearId: 'year-1',
            examType: { name: 'Exam' },
          },
          results: [{ studentId: 's-2', status: 'SUBMITTED' }],
          classSubject: { subject: { name: 'Physics' } },
        },
        {
          id: 'es-2',
          exam: {
            id: 'exam-2',
            name: 'Old',
            status: 'PUBLISHED',
            academicYearId: 'year-1',
            examType: null,
          },
          results: [{ studentId: 's-2', status: 'PUBLISHED' }],
          classSubject: { subject: { name: 'Math' } },
        },
        {
          id: 'es-3',
          exam: {
            id: 'exam-3',
            name: 'Blank',
            status: 'DRAFT',
            academicYearId: 'year-1',
            examType: null,
          },
          results: [],
          classSubject: { subject: { name: 'Art' } },
        },
      ]);
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-2' }]);

      const queue = await service.listSupervisorQueue(TENANT, TEACHER_B_USER);

      expect(queue.classes).toHaveLength(1);
      expect(queue.classes[0].exams).toHaveLength(1);
      expect(queue.classes[0].exams[0]).toMatchObject({
        examId: 'exam-1',
        readyToApprove: true,
      });
      expect(queue.classes[0].exams[0].subjects[0]).toMatchObject({
        subjectName: 'Physics',
        submitted: 1,
        total: 1,
        allSubmitted: true,
      });
    });
  });

  describe('student lookup boundary', () => {
    it('refuses a classId the teacher does not teach', async () => {
      db.classSubject.findMany.mockResolvedValue([{ classId: 'class-1' }]);
      await expect(
        service.searchStudents(TENANT, TEACHER_A_USER, 'bea', 'class-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s (not 403) for a student outside my classes', async () => {
      db.studentEnrollment.findFirst.mockResolvedValue(null);
      await expect(
        service.getStudentDetail(TENANT, TEACHER_A_USER, 's-other'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('announcements', () => {
    it('refuses composing for a class I do not teach', async () => {
      db.classSubject.findFirst.mockResolvedValue(null);
      await expect(
        service.createAnnouncement(TENANT, TEACHER_A_USER, {
          classId: 'class-2',
          title: 'Test',
          message: 'Hello parents',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('fans out to parents + students of my class only', async () => {
      db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
      db.studentEnrollment.findMany.mockResolvedValue([
        {
          student: {
            userId: 'stu-user-1',
            guardians: [{ guardian: { userId: 'par-user-1' } }, { guardian: { userId: null } }],
          },
        },
      ]);
      db.notification.createMany.mockResolvedValue({ count: 2 });

      const result = await service.createAnnouncement(TENANT, TEACHER_A_USER, {
        classId: 'class-1',
        title: 'Field trip',
        message: 'Please send the form back by Friday.',
      });
      expect(result).toEqual({ recipients: 2 });
      expect(db.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ userId: 'stu-user-1', type: 'CLASS_ANNOUNCEMENT' }),
            expect.objectContaining({ userId: 'par-user-1' }),
          ]),
        }),
      );
    });
  });

  describe('teacher profile resolution', () => {
    it('403s a user without a teacher profile', async () => {
      db.teacher.findFirst.mockResolvedValue(null);
      await expect(service.getProfile(TENANT, 'no-teacher-user')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('realtime emissions', () => {
    it('emits marks.entered to the subject class room after saving', async () => {
      db.examSubject.findFirst.mockResolvedValue({
        id: 'es-1',
        maxMarks: { toNumber: () => 100 },
        exam: { id: 'exam-1', authorId: 'someone-else', academicYearId: 'year-1' },
        classSubject: { id: 'cs-b', teacherId: TEACHER_B, classId: 'class-2' },
        gradingScale: null,
      });
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-2' }]);
      db.examResult.upsert.mockResolvedValue({ id: 'r-1' });

      await service.enterMarks(TENANT, TEACHER_B_USER, 'exam-1', 'es-1', [
        { studentId: 's-2', marks: 80 },
      ]);

      expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
        kind: 'marks.entered',
        rooms: ['class:class-2'],
        payload: { examId: 'exam-1', examSubjectId: 'es-1' },
      });
    });

    it('emits attendance.marked to the class room and school-wide after saving', async () => {
      db.attendanceSession.findFirst.mockResolvedValue({
        id: 'sess-1',
        classId: 'class-1',
        attendanceDate: new Date(),
      });
      db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-1' }]);
      db.attendanceRecord.upsert.mockResolvedValue({ id: 'ar-1' });

      await service.markAttendanceSession(TENANT, TEACHER_A_USER, 'sess-1', [
        { studentId: 's-1', status: 'PRESENT' },
      ]);

      expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
        kind: 'attendance.marked',
        rooms: ['class:class-1', 'school-wide'],
        payload: { sessionId: 'sess-1' },
      });
    });

    it('emits attendance_updated to the class room and school-wide with the refresh scope', async () => {
      const attendanceDate = new Date();
      db.attendanceSession.findFirst.mockResolvedValue({
        id: 'sess-1',
        classId: 'class-1',
        attendanceDate,
      });
      db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
      db.studentEnrollment.findMany.mockResolvedValue([{ studentId: 's-1' }]);
      db.attendanceRecord.upsert.mockResolvedValue({ id: 'ar-1' });

      await service.markAttendanceSession(TENANT, TEACHER_A_USER, 'sess-1', [
        { studentId: 's-1', status: 'PRESENT' },
      ]);

      expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
        kind: 'attendance_updated',
        rooms: ['class:class-1', 'school-wide'],
        payload: {
          entityType: 'student',
          sessionId: 'sess-1',
          classId: 'class-1',
          date: attendanceDate,
        },
      });
    });

    it('emits notification.created to the class room on announcement', async () => {
      db.classSubject.findFirst.mockResolvedValue({ id: 'cs-1' });
      db.studentEnrollment.findMany.mockResolvedValue([
        {
          student: {
            userId: 'stu-user-1',
            guardians: [{ guardian: { userId: 'par-user-1' } }],
          },
        },
      ]);
      db.notification.createMany.mockResolvedValue({ count: 2 });

      await service.createAnnouncement(TENANT, TEACHER_A_USER, {
        classId: 'class-1',
        title: 'Field trip',
        message: 'Please send the form back by Friday.',
      });

      expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
        kind: 'notification.created',
        rooms: ['class:class-1'],
        payload: expect.objectContaining({ title: 'Field trip' }),
      });
    });
  });

  describe('socket ticket', () => {
    it('mints a short-lived, socket-scoped ticket for a resolved teacher', async () => {
      mockTeacherProfiles(db);

      const result = await service.mintSocketTicket(TENANT, TEACHER_A_USER);

      expect(result).toEqual({ ticket: 'test-ticket', expiresIn: 600 });
      expect(jwt.signAsync).toHaveBeenCalledWith(
        { sub: TEACHER_A_USER, tenantId: TENANT },
        expect.objectContaining({ audience: 'socket' }),
      );
    });

    it('refuses a ticket when there is no teacher profile for this account', async () => {
      db.teacher.findFirst.mockResolvedValue(null);

      await expect(service.mintSocketTicket(TENANT, 'no-teacher-user')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
