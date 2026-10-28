import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { safeUserSelect } from '../common/safe-user.select';
import { FinancePayrollService } from '../finance/finance-payroll.service';
import { RealtimeGateway, roomsForTarget } from '../realtime/realtime.gateway';
import { ExamsService } from '../exams/exams.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ATTENDANCE_EDIT_WINDOW_DAYS,
  canEditAttendance,
  localDateKey,
  storedDateKey,
} from '../common/attendance-window.util';
import {
  CreateTeacherAnnouncementDto,
  CreateTeacherSessionDto,
} from './dto/teacher-me.dto';

type Db = Prisma.TransactionClient | PrismaService;

type QueueSubject = {
  examSubjectId: string;
  subjectName: string;
  submitted: number;
  total: number;
  allSubmitted: boolean;
};

type QueueExam = {
  examId: string;
  examName: string;
  status: string;
  examType: string | null;
  subjects: QueueSubject[];
  readyToApprove: boolean;
};

const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

function dayKey(date: Date): (typeof DAY_KEYS)[number] {
  return DAY_KEYS[date.getDay()];
}

function fullName(person: { firstName: string; lastName?: string | null }): string {
  return [person.firstName, person.lastName].filter(Boolean).join(' ');
}

function canEditOn(dateKey: string, todayKey: string): boolean {
  return canEditAttendance(dateKey, todayKey);
}

export { ATTENDANCE_EDIT_WINDOW_DAYS };

@Injectable()
export class TeachersMeService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
    private exams: ExamsService,
    private notifications: NotificationsService,
    private jwt: JwtService,
    private financePayroll: FinancePayrollService,
  ) {}

  // -------------------------------------------------------------------------
  // Shared lookups
  // -------------------------------------------------------------------------

  // GET /teachers/me/payroll — the caller's own payslips and YTD aggregates.
  // userId is session-derived (never a path parameter), and the aggregate
  // math lives in FinancePayrollService, so teacher and accountant registers
  // cannot drift apart.
  async myPayroll(tenantId: string, userId: string) {
    return this.financePayroll.listMyPayouts(tenantId, userId);
  }

  /** The Teacher row behind the authenticated user; 403 when there is none. */
  private async resolveTeacher(db: Db, tenantId: string, userId: string) {
    const teacher = await db.teacher.findFirst({
      where: { tenantId, userId },
      select: { id: true, userId: true, employeeNumber: true, status: true },
    });
    if (!teacher) {
      throw new ForbiddenException('No teacher profile exists for this account in this school');
    }
    if (teacher.status !== 'ACTIVE') {
      throw new ForbiddenException('This teacher account is not active');
    }
    return teacher;
  }

  /**
   * Short-lived credential for the socket handshake.
   *
   * The session JWT lives in an httpOnly cookie that JS cannot read, and
   * cross-origin Lax cookies do not ride a websocket handshake — so the portal
   * exchanges its session for a 10-minute, socket-audience-scoped ticket
   * instead of ever exposing the session token to JS. Mirrors students-me.
   */
  async mintSocketTicket(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      await this.resolveTeacher(db, tenantId, userId);
      const ticket = await this.jwt.signAsync(
        { sub: userId, tenantId },
        { expiresIn: '600s', audience: 'socket' },
      );
      return { ticket, expiresIn: 600 };
    });
  }

  private async currentYear(db: Db, tenantId: string) {
    const year = await db.academicYear.findFirst({
      where: { tenantId, isCurrent: true },
      orderBy: { startsOn: 'desc' },
      select: { id: true, name: true, startsOn: true, endsOn: true },
    });
    if (year) return year;
    const latest = await db.academicYear.findFirst({
      where: { tenantId },
      orderBy: { startsOn: 'desc' },
      select: { id: true, name: true, startsOn: true, endsOn: true },
    });
    if (!latest) throw new NotFoundException('No academic year exists for this school');
    return latest;
  }

  /** The class this teacher teaches in, via their ClassSubject assignments. */
  private async assertTeacherClass(db: Db, tenantId: string, teacherId: string, classId: string) {
    const assignment = await db.classSubject.findFirst({
      where: { tenantId, teacherId, classId },
      select: { id: true },
    });
    if (!assignment) {
      throw new ForbiddenException('You do not teach this class');
    }
  }

  private async myClassSubjectIds(db: Db, tenantId: string, teacherId: string): Promise<string[]> {
    const rows = await db.classSubject.findMany({
      where: { tenantId, teacherId },
      select: { classId: true },
    });
    return [...new Set(rows.map((row) => row.classId))];
  }

  private async myTimetableEntries(db: Db, tenantId: string, teacherId: string, yearId: string) {
    return db.timetableEntry.findMany({
      where: {
        tenantId,
        teacherId,
        academicYearId: yearId,
        timetableType: 'REGULAR',
      },
      include: {
        subject: { select: { id: true, name: true } },
        schoolClass: { select: { id: true, className: true } },
      },
      orderBy: [{ startTime: 'asc' }, { periodNo: 'asc' }],
    });
  }

  /** Active enrollment count per class for one academic year. */
  private async enrolledCounts(
    db: Db,
    tenantId: string,
    yearId: string,
    classIds: string[],
  ): Promise<Map<string, number>> {
    if (classIds.length === 0) return new Map();
    const grouped = await db.studentEnrollment.groupBy({
      by: ['classId'],
      where: { tenantId, status: 'ACTIVE', academicYearId: yearId, classId: { in: classIds } },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.classId, row._count._all]));
  }

  /** The academic year that contains `date`, falling back to the current one. */
  private async yearForDate(db: Db, tenantId: string, date: Date) {
    const containing = await db.academicYear.findFirst({
      where: { tenantId, startsOn: { lte: date }, endsOn: { gte: date } },
      orderBy: { startsOn: 'desc' },
      select: { id: true, name: true },
    });
    return containing ?? this.currentYear(db, tenantId);
  }

  private assertWithinEditWindow(attendanceKey: string, todayKey: string) {
    if (attendanceKey > todayKey) {
      throw new BadRequestException('Attendance cannot be recorded for a future date');
    }
    if (!canEditOn(attendanceKey, todayKey)) {
      throw new ForbiddenException(
        `Attendance is locked: the edit window is ${ATTENDANCE_EDIT_WINDOW_DAYS} days`,
      );
    }
  }

  private sessionStatus(recordCount: number, enrolled: number | undefined) {
    if (recordCount === 0) return 'NOT_STARTED';
    if (enrolled !== undefined && recordCount >= enrolled) return 'SUBMITTED';
    return 'IN_PROGRESS';
  }

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------

  async getProfile(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      return db.teacher.findFirst({
        where: { id: teacher.id, tenantId },
        select: {
          id: true,
          employeeNumber: true,
          specialization: true,
          hireDate: true,
          gender: true,
          dateOfBirth: true,
          status: true,
          user: { select: safeUserSelect },
          department: { select: { id: true, name: true } },
          _count: { select: { classSubjects: true, classTeacherFor: true } },
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  async getDashboard(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const year = await this.currentYear(db, tenantId);

      const entries = await this.myTimetableEntries(db, tenantId, teacher.id, year.id);
      const today = dayKey(new Date());
      const todayEntries = entries.filter((entry) => entry.dayOfWeek === today);
      const todayClassIds = [...new Set(todayEntries.map((entry) => entry.classId))];

      // Pending attendance: scheduled classes today without any recorded mark.
      const todaySessions = todayClassIds.length
        ? await db.attendanceSession.findMany({
            where: {
              tenantId,
              classId: { in: todayClassIds },
              attendanceDate: new Date(`${localDateKey(new Date())}T00:00:00.000Z`),
            },
            select: { classId: true, _count: { select: { records: true } } },
          })
        : [];
      const recordedClassIds = new Set(
        todaySessions.filter((session) => session._count.records > 0).map((s) => s.classId),
      );
      const pendingAttendance = todayClassIds.filter((id) => !recordedClassIds.has(id)).length;

      const todaySchedule = todayEntries.map((entry) => ({
        periodNo: entry.periodNo,
        dayOfWeek: entry.dayOfWeek,
        startTime: entry.startTime,
        endTime: entry.endTime,
        isBreak: entry.isBreak,
        room: entry.room,
        classId: entry.classId,
        className: entry.schoolClass.className,
        subjectId: entry.subjectId,
        subjectName: entry.subject?.name ?? null,
      }));

      // Next session: the first one whose end time has not passed yet.
      const nowKey = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
      const nextSession =
        todaySchedule.find((entry) => !entry.isBreak && entry.endTime > nowKey) ?? null;

      // Pending marks: my exam subjects where entered results trail the roster.
      const pendingMarksQueue = await this.pendingMarksRows(db, tenantId, teacher.id);

      const recentAnnouncements = await db.notification.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          title: true,
          body: true,
          type: true,
          status: true,
          readAt: true,
          createdAt: true,
        },
      });

      return {
        teacherName: await this.teacherName(db, tenantId, teacher.id),
        year: { id: year.id, name: year.name },
        classesToday: todayClassIds.length,
        pendingAttendance,
        pendingMarks: pendingMarksQueue.reduce((sum, exam) => sum + exam.pendingCount, 0),
        nextSession,
        todaySchedule,
        pendingMarksQueue: pendingMarksQueue.slice(0, 5),
        recentAnnouncements,
      };
    });
  }

  private async teacherName(db: Db, tenantId: string, teacherId: string) {
    const teacher = await db.teacher.findFirst({
      where: { id: teacherId, tenantId },
      select: { user: { select: { firstName: true, lastName: true } } },
    });
    return teacher ? fullName(teacher.user) : 'Teacher';
  }

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------

  async listClasses(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const year = await this.currentYear(db, tenantId);

      const assignments = await db.classSubject.findMany({
        where: { tenantId, teacherId: teacher.id },
        include: {
          schoolClass: { select: { id: true, className: true, educationLevel: true, grade: true, track: true } },
          subject: { select: { id: true, name: true } },
        },
        orderBy: { schoolClass: { className: 'asc' } },
      });

      const classIds = [...new Set(assignments.map((a) => a.schoolClass.id))];
      const enrolled = await this.enrolledCounts(db, tenantId, year.id, classIds);

      const grouped = new Map<
        string,
        {
          classId: string;
          className: string;
          educationLevel: string;
          grade: string;
          track: string | null;
          studentCount: number;
          subjects: { classSubjectId: string; subjectId: string; subjectName: string }[];
        }
      >();
      for (const assignment of assignments) {
        const existing = grouped.get(assignment.schoolClass.id);
        const subjectEntry = {
          classSubjectId: assignment.id,
          subjectId: assignment.subject.id,
          subjectName: assignment.subject.name,
        };
        if (existing) {
          existing.subjects.push(subjectEntry);
        } else {
          grouped.set(assignment.schoolClass.id, {
            classId: assignment.schoolClass.id,
            className: assignment.schoolClass.className,
            educationLevel: assignment.schoolClass.educationLevel,
            grade: assignment.schoolClass.grade,
            track: assignment.schoolClass.track,
            studentCount: enrolled.get(assignment.schoolClass.id) ?? 0,
            subjects: [subjectEntry],
          });
        }
      }

      return { year: { id: year.id, name: year.name }, classes: [...grouped.values()] };
    });
  }

  async getClassDetail(tenantId: string, userId: string, classId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      await this.assertTeacherClass(db, tenantId, teacher.id, classId);
      const year = await this.currentYear(db, tenantId);

      const schoolClass = await db.schoolClass.findFirst({
        where: { id: classId, tenantId },
        select: {
          id: true,
          className: true,
          educationLevel: true,
          grade: true,
          track: true,
          capacity: true,
        },
      });
      if (!schoolClass) throw new NotFoundException('Class not found');

      const [mySubjects, roster, timetableEntries] = await Promise.all([
        db.classSubject.findMany({
          where: { tenantId, teacherId: teacher.id, classId },
          include: { subject: { select: { id: true, name: true } } },
          orderBy: { subject: { name: 'asc' } },
        }),
        db.studentEnrollment.findMany({
          where: { tenantId, classId, academicYearId: year.id, status: 'ACTIVE' },
          include: {
            student: {
              select: {
                id: true,
                roleNumber: true,
                firstName: true,
                middleName: true,
                lastName: true,
                gender: true,
                photoUrl: true,
                status: true,
              },
            },
          },
          orderBy: { student: { firstName: 'asc' } },
        }),
        db.timetableEntry.findMany({
          where: { tenantId, classId, academicYearId: year.id, timetableType: 'REGULAR' },
          include: {
            subject: { select: { id: true, name: true } },
            teacher: { select: { user: { select: { firstName: true, lastName: true } } } },
          },
          orderBy: [{ startTime: 'asc' }, { periodNo: 'asc' }],
        }),
      ]);

      return {
        class: schoolClass,
        year: { id: year.id, name: year.name },
        mySubjects: mySubjects.map((assignment) => ({
          classSubjectId: assignment.id,
          subjectId: assignment.subject.id,
          subjectName: assignment.subject.name,
        })),
        students: roster.map((enrollment) => ({
          enrollmentId: enrollment.id,
          student: enrollment.student,
        })),
        timetable: timetableEntries.map((entry) => ({
          id: entry.id,
          dayOfWeek: entry.dayOfWeek,
          periodNo: entry.periodNo,
          startTime: entry.startTime,
          endTime: entry.endTime,
          isBreak: entry.isBreak,
          room: entry.room,
          subjectName: entry.subject?.name ?? null,
          teacherName: entry.teacher ? fullName(entry.teacher.user) : null,
          isMine: entry.teacherId === teacher.id,
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Timetable
  // -------------------------------------------------------------------------

  async getTimetable(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const year = await this.currentYear(db, tenantId);
      const entries = await this.myTimetableEntries(db, tenantId, teacher.id, year.id);

      return {
        teacherName: await this.teacherName(db, tenantId, teacher.id),
        year: { id: year.id, name: year.name },
        entries: entries.map((entry) => ({
          id: entry.id,
          dayOfWeek: entry.dayOfWeek,
          periodNo: entry.periodNo,
          startTime: entry.startTime,
          endTime: entry.endTime,
          isBreak: entry.isBreak,
          room: entry.room,
          classId: entry.classId,
          className: entry.schoolClass.className,
          subjectId: entry.subjectId,
          subjectName: entry.subject?.name ?? null,
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Attendance
  // -------------------------------------------------------------------------

  /**
   * One row per timetable period this teacher teaches on `date`'s weekday,
   * each carrying its own attendance session (if any) — plus one "whole
   * day" row per legacy session recorded before periods existed
   * (subjectId null), so old marks stay reachable.
   */
  async listAttendanceSessions(tenantId: string, userId: string, date: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const year = await this.currentYear(db, tenantId);
      const dateObj = new Date(date);
      const weekday = dayKey(dateObj);

      const entries = (await this.myTimetableEntries(db, tenantId, teacher.id, year.id)).filter(
        (entry) => entry.dayOfWeek === weekday && entry.subjectId,
      );

      const classIds = [...new Set(entries.map((entry) => entry.classId))];
      const className = new Map(entries.map((entry) => [entry.classId, entry.schoolClass.className]));
      const sessions = classIds.length
        ? await db.attendanceSession.findMany({
            where: { tenantId, classId: { in: classIds }, attendanceDate: dateObj },
            include: {
              _count: { select: { records: true } },
              schoolClass: { select: { id: true, className: true } },
            },
          })
        : [];
      const sessionByPeriod = new Map(
        sessions
          .filter((session) => session.subjectId)
          .map((session) => [`${session.classId}|${session.subjectId}|${session.sessionNumber}`, session]),
      );
      const legacySessions = sessions.filter((session) => !session.subjectId);
      const enrolled = await this.enrolledCounts(db, tenantId, year.id, classIds);

      const todayKey = localDateKey(new Date());
      const dateKey = storedDateKey(dateObj);
      const editable = canEditOn(dateKey, todayKey);

      const toSession = (session: (typeof sessions)[number] | null, classId: string) => {
        if (!session) return null;
        const recordCount = session._count.records;
        return {
          id: session.id,
          attendanceDate: session.attendanceDate,
          subjectId: session.subjectId,
          sessionNumber: session.sessionNumber,
          recordCount,
          status: this.sessionStatus(recordCount, enrolled.get(classId)),
        };
      };

      const rows: Array<{
        classId: string;
        className: string | null | undefined;
        periodNo: number | null;
        startTime: string | null;
        endTime: string | null;
        subjectId: string | null;
        subjectName: string | null;
        session: ReturnType<typeof toSession>;
        editable: boolean;
      }> = entries.map((entry) => ({
        classId: entry.classId,
        className: className.get(entry.classId),
        periodNo: entry.periodNo,
        startTime: entry.startTime,
        endTime: entry.endTime,
        subjectId: entry.subjectId,
        subjectName: entry.subject?.name ?? null,
        session: toSession(
          sessionByPeriod.get(`${entry.classId}|${entry.subjectId}|${entry.periodNo}`) ?? null,
          entry.classId,
        ),
        editable,
      }));
      for (const session of legacySessions) {
        rows.push({
          classId: session.classId,
          className: session.schoolClass?.className ?? className.get(session.classId) ?? null,
          periodNo: null,
          startTime: null,
          endTime: null,
          subjectId: null,
          subjectName: null,
          session: toSession(session, session.classId),
          editable,
        });
      }

      return { date: dateKey, weekday, rows };
    });
  }

  /**
   * One session per timetable period: the session is stored with
   * `sessionNumber = periodNo` and the subject derived server-side from the
   * teacher's timetable entry for class + day + period. A DTO-supplied
   * subjectId is accepted but ignored so a session can never be filed under
   * a subject the teacher does not teach in that period.
   */
  async createAttendanceSession(tenantId: string, userId: string, dto: CreateTeacherSessionDto) {
    return this.prisma.withTenant(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      await this.assertTeacherClass(db, tenantId, teacher.id, dto.classId);

      const todayKey = localDateKey(new Date());
      const dateKey = storedDateKey(new Date(dto.date));
      this.assertWithinEditWindow(dateKey, todayKey);

      const year = await this.currentYear(db, tenantId);
      const weekday = dayKey(new Date(dto.date));
      const entries = await this.myTimetableEntries(db, tenantId, teacher.id, year.id);
      const period = entries.find(
        (entry) =>
          entry.classId === dto.classId &&
          entry.dayOfWeek === weekday &&
          entry.periodNo === dto.periodNo &&
          entry.subjectId,
      );
      if (!period) {
        throw new NotFoundException(
          `No timetabled period ${dto.periodNo} for this class on ${dateKey}`,
        );
      }

      const existing = await db.attendanceSession.findFirst({
        where: {
          tenantId,
          classId: dto.classId,
          subjectId: period.subjectId,
          attendanceDate: new Date(dto.date),
          sessionNumber: dto.periodNo,
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `An attendance session already exists for period ${dto.periodNo} on ${dateKey}`,
        );
      }

      return db.attendanceSession.create({
        data: {
          tenantId,
          classId: dto.classId,
          subjectId: period.subjectId,
          teacherId: teacher.id,
          attendanceDate: new Date(dto.date),
          sessionNumber: dto.periodNo,
        },
        include: { schoolClass: { select: { id: true, className: true } } },
      });
    });
  }

  /**
   * The take-attendance grid payload: the class roster with any already-saved
   * status merged in, plus an `editable` flag for the locked state.
   */
  async getAttendanceSession(tenantId: string, userId: string, sessionId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const session = await db.attendanceSession.findFirst({
        where: { id: sessionId, tenantId },
        include: {
          schoolClass: { select: { id: true, className: true } },
          subject: { select: { id: true, name: true } },
          records: { select: { studentId: true, status: true, remarks: true } },
        },
      });
      if (!session) throw new NotFoundException('Attendance session not found');
      await this.assertTeacherClass(db, tenantId, teacher.id, session.classId);

      const year = await this.yearForDate(db, tenantId, session.attendanceDate);
      const roster = await db.studentEnrollment.findMany({
        where: { tenantId, classId: session.classId, academicYearId: year.id, status: 'ACTIVE' },
        include: {
          student: {
            select: { id: true, roleNumber: true, firstName: true, middleName: true, lastName: true, photoUrl: true },
          },
        },
        orderBy: { student: { firstName: 'asc' } },
      });
      const recordByStudent = new Map(session.records.map((record) => [record.studentId, record]));

      const todayKey = localDateKey(new Date());
      const dateKey = storedDateKey(session.attendanceDate);

      return {
        session: {
          id: session.id,
          classId: session.classId,
          className: session.schoolClass.className,
          subjectId: session.subjectId,
          subjectName: session.subject?.name ?? null,
          attendanceDate: session.attendanceDate,
        },
        editable: canEditOn(dateKey, todayKey),
        students: roster.map((enrollment) => {
          const record = recordByStudent.get(enrollment.student.id);
          return {
            studentId: enrollment.student.id,
            roleNumber: enrollment.student.roleNumber,
            fullName: fullName(enrollment.student),
            photoUrl: enrollment.student.photoUrl,
            status: record?.status ?? null,
            remarks: record?.remarks ?? null,
          };
        }),
      };
    });
  }

  async markAttendanceSession(
    tenantId: string,
    userId: string,
    sessionId: string,
    records: { studentId: string; status: string; remarks?: string }[],
  ) {
    return this.prisma.withTenant(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const session = await db.attendanceSession.findFirst({
        where: { id: sessionId, tenantId },
        select: { id: true, classId: true, attendanceDate: true },
      });
      if (!session) throw new NotFoundException('Attendance session not found');
      await this.assertTeacherClass(db, tenantId, teacher.id, session.classId);

      const todayKey = localDateKey(new Date());
      this.assertWithinEditWindow(storedDateKey(session.attendanceDate), todayKey);

      // Only students enrolled in the session's class may be marked: a
      // spoofed studentId must not create attendance history elsewhere.
      const year = await this.yearForDate(db, tenantId, session.attendanceDate);
      const roster = await db.studentEnrollment.findMany({
        where: { tenantId, classId: session.classId, academicYearId: year.id, status: 'ACTIVE' },
        select: { studentId: true },
      });
      const rosterIds = new Set(roster.map((row) => row.studentId));
      const invalid = records.filter((record) => !rosterIds.has(record.studentId));
      if (invalid.length > 0) {
        throw new BadRequestException(
          `These students are not enrolled in this class: ${invalid.map((r) => r.studentId).join(', ')}`,
        );
      }

      const results: unknown[] = [];
      for (const record of records) {
        results.push(
          await db.attendanceRecord.upsert({
            where: {
              attendanceSessionId_studentId: {
                attendanceSessionId: session.id,
                studentId: record.studentId,
              },
            },
            create: {
              tenantId,
              attendanceSessionId: session.id,
              studentId: record.studentId,
              status: record.status as never,
              remarks: record.remarks,
            },
            update: {
              status: record.status as never,
              remarks: record.remarks,
            },
          }),
        );
      }

      await this.realtime.emitDomainEvent({
        kind: 'attendance.marked',
        rooms: [...roomsForTarget('CLASS', session.classId), ...roomsForTarget('SCHOOL_WIDE', null)],
        payload: { sessionId: session.id },
      });
      await this.realtime.emitDomainEvent({
        kind: 'attendance_updated',
        rooms: [...roomsForTarget('CLASS', session.classId), ...roomsForTarget('SCHOOL_WIDE', null)],
        payload: {
          entityType: 'student',
          sessionId: session.id,
          classId: session.classId,
          date: session.attendanceDate,
        },
      });

      return { saved: results.length };
    });
  }

  // -------------------------------------------------------------------------
  // Exams & marks
  // -------------------------------------------------------------------------

  private examSubjectSelect() {
    return {
      id: true,
      examId: true,
      examDate: true,
      maxMarks: true,
      passingMarks: true,
      classSubject: {
        select: {
          id: true,
          classId: true,
          teacherId: true,
          subject: { select: { id: true, name: true } },
          schoolClass: { select: { id: true, className: true } },
        },
      },
      _count: { select: { results: true } },
    } as const;
  }

  /**
   * My exam subjects joined with roster sizes — the basis for both the
   * dashboard's pending-marks stat and the Marks Entry queue.
   */
  private async pendingMarksRows(db: Db, tenantId: string, teacherId: string) {
    const year = await this.currentYear(db, tenantId);
    const subjects = await db.examSubject.findMany({
      where: { tenantId, classSubject: { teacherId } },
      select: this.examSubjectSelect(),
      orderBy: { exam: { createdAt: 'asc' } },
    });
    if (subjects.length === 0) return [];

    const exams = await db.exam.findMany({
      where: { tenantId, id: { in: [...new Set(subjects.map((s) => s.examId))] } },
      select: { id: true, name: true, status: true, startsOn: true, endsOn: true, createdAt: true, academicYearId: true },
    });
    const examById = new Map(exams.map((exam) => [exam.id, exam]));

    const classYearPairs = [...new Set(subjects.map((s) => `${s.classSubject.classId}:${examById.get(s.examId)?.academicYearId ?? year.id}`))];
    const countPairs = await db.studentEnrollment.groupBy({
      by: ['classId', 'academicYearId'],
      where: {
        tenantId,
        status: 'ACTIVE',
        OR: classYearPairs.map((pair) => {
          const [classId, academicYearId] = pair.split(':');
          return { classId, academicYearId };
        }),
      },
      _count: { _all: true },
    });
    const enrolledByKey = new Map(
      countPairs.map((row) => [`${row.classId}:${row.academicYearId}`, row._count._all]),
    );

    const grouped = new Map<
      string,
      {
        examId: string;
        examName: string;
        examStatus: string;
        examDate: Date | null;
        createdAt: Date;
        subjects: {
          examSubjectId: string;
          subjectName: string;
          className: string;
          entered: number;
          total: number;
        }[];
        enteredCount: number;
        totalCount: number;
        pendingCount: number;
      }
    >();
    for (const subject of subjects) {
      const exam = examById.get(subject.examId);
      if (!exam) continue;
      const total =
        enrolledByKey.get(`${subject.classSubject.classId}:${exam.academicYearId}`) ?? 0;
      const entered = subject._count.results;
      const entry = {
        examSubjectId: subject.id,
        subjectName: subject.classSubject.subject.name,
        className: subject.classSubject.schoolClass.className,
        entered,
        total,
      };
      const existing = grouped.get(exam.id);
      if (existing) {
        existing.subjects.push(entry);
        existing.enteredCount += entered;
        existing.totalCount += total;
        if (entered < total) existing.pendingCount += 1;
      } else {
        grouped.set(exam.id, {
          examId: exam.id,
          examName: exam.name,
          examStatus: exam.status,
          examDate: exam.startsOn,
          createdAt: exam.createdAt,
          subjects: [entry],
          enteredCount: entered,
          totalCount: total,
          pendingCount: entered < total ? 1 : 0,
        });
      }
    }

    return [...grouped.values()]
      .map((row) => ({ ...row, pending: row.pendingCount > 0 }))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async listPendingMarks(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const queue = await this.pendingMarksRows(db, tenantId, teacher.id);
      return { exams: queue };
    });
  }

  async listExams(tenantId: string, userId: string, scope: 'authored' | 'assigned' | 'all' = 'all') {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);

      const authored = { authorId: userId };
      const assigned = { examSubjects: { some: { classSubject: { teacherId: teacher.id } } } };
      const where: Record<string, unknown> = { tenantId };
      if (scope === 'authored') where.AND = [authored];
      else if (scope === 'assigned') where.AND = [assigned];
      else where.OR = [authored, assigned];

      const exams = await db.exam.findMany({
        where,
        include: {
          author: { select: { id: true, firstName: true, lastName: true } },
          examType: { select: { id: true, name: true } },
          _count: { select: { examSubjects: true, examRoomAssignments: true } },
          examSubjects: {
            select: {
              id: true,
              examDate: true,
              classSubject: {
                select: {
                  classId: true,
                  teacherId: true,
                  subject: { select: { name: true } },
                  schoolClass: { select: { className: true } },
                },
              },
              _count: { select: { results: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      // Roster sizes for every (class, year) pair present in the list.
      const pairs = new Set<string>();
      for (const exam of exams) {
        for (const subject of exam.examSubjects) {
          pairs.add(`${subject.classSubject.classId}:${exam.academicYearId}`);
        }
      }
      const countPairs = pairs.size
        ? await db.studentEnrollment.groupBy({
            by: ['classId', 'academicYearId'],
            where: {
              tenantId,
              status: 'ACTIVE',
              OR: [...pairs].map((pair) => {
                const [classId, academicYearId] = pair.split(':');
                return { classId, academicYearId };
              }),
            },
            _count: { _all: true },
          })
        : [];
      const enrolledByKey = new Map(
        countPairs.map((row) => [`${row.classId}:${row.academicYearId}`, row._count._all]),
      );

      return {
        exams: exams.map((exam) => {
          const isAuthor = exam.authorId === userId;
          const roomLocked = exam._count.examRoomAssignments > 0;
          const mySubjects = exam.examSubjects
            .filter((subject) => isAuthor || subject.classSubject.teacherId === teacher.id)
            .map((subject) => {
              const total = enrolledByKey.get(`${subject.classSubject.classId}:${exam.academicYearId}`) ?? 0;
              return {
                examSubjectId: subject.id,
                subjectName: subject.classSubject.subject.name,
                className: subject.classSubject.schoolClass.className,
                examDate: subject.examDate,
                entered: subject._count.results,
                total,
                pending: subject._count.results < total,
              };
            });
          return {
            id: exam.id,
            name: exam.name,
            status: exam.status,
            startsOn: exam.startsOn,
            endsOn: exam.endsOn,
            createdAt: exam.createdAt,
            examType: exam.examType,
            author: exam.author ? { id: exam.author.id, name: fullName(exam.author) } : null,
            isAuthor,
            roomLocked,
            canEdit: isAuthor && !roomLocked,
            subjectsTotal: exam._count.examSubjects,
            mySubjects,
            pendingSubjects: mySubjects.filter((subject) => subject.pending).length,
          };
        }),
      };
    });
  }

  /**
   * Teacher-scoped exam detail. A teacher who authored the exam sees all of
   * its subjects; a teacher who is only an assigned subject teacher sees just
   * their own subject(s) — other subjects' marks stay invisible.
   */
  async getExamDetail(tenantId: string, userId: string, examId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);

      const exam = await db.exam.findFirst({
        where: { id: examId, tenantId },
        include: {
          author: { select: { id: true, firstName: true, lastName: true } },
          examType: { select: { id: true, name: true } },
          academicYear: { select: { id: true, name: true } },
          term: { select: { id: true, name: true } },
          _count: { select: { examRoomAssignments: true } },
          examSubjects: {
            include: {
              classSubject: {
                include: {
                  subject: { select: { id: true, name: true } },
                  schoolClass: { select: { id: true, className: true } },
                },
              },
              gradingScale: { select: { id: true, name: true } },
              results: {
                select: { studentId: true, marks: true, grade: true, remarks: true, status: true },
              },
            },
            orderBy: { classSubject: { subject: { name: 'asc' } } },
          },
        },
      });
      if (!exam) throw new NotFoundException('Exam not found');

      const isAuthor = exam.authorId === userId;
      let supervisedClassIds: string[] = [];
      if (!isAuthor) {
        const supervised = await db.schoolClass.findMany({
          where: { tenantId, classTeacherId: teacher.id },
          select: { id: true },
        });
        supervisedClassIds = supervised.map((entry) => entry.id);
      }
      const visibleSubjects = isAuthor
        ? exam.examSubjects
        : exam.examSubjects.filter(
            (subject) =>
              subject.classSubject.teacherId === teacher.id ||
              supervisedClassIds.includes(subject.classSubject.classId),
          );
      if (!isAuthor && visibleSubjects.length === 0) {
        throw new ForbiddenException('You are not assigned to any subject in this exam');
      }

      // Rosters per class, one query per distinct class of the visible subjects.
      const rosterByClass = new Map<string, { studentId: string; roleNumber: string; fullName: string }[]>();
      const distinctClasses = [...new Set(visibleSubjects.map((s) => s.classSubject.classId))];
      for (const classId of distinctClasses) {
        const roster = await db.studentEnrollment.findMany({
          where: { tenantId, classId, academicYearId: exam.academicYearId, status: 'ACTIVE' },
          include: {
            student: { select: { id: true, roleNumber: true, firstName: true, lastName: true } },
          },
          orderBy: { student: { firstName: 'asc' } },
        });
        rosterByClass.set(
          classId,
          roster.map((enrollment) => ({
            studentId: enrollment.student.id,
            roleNumber: enrollment.student.roleNumber,
            fullName: fullName(enrollment.student),
          })),
        );
      }

      const roomLocked = exam._count.examRoomAssignments > 0;
      return {
        id: exam.id,
        name: exam.name,
        status: exam.status,
        startsOn: exam.startsOn,
        endsOn: exam.endsOn,
        createdAt: exam.createdAt,
        examType: exam.examType,
        year: exam.academicYear,
        term: exam.term,
        author: exam.author ? { id: exam.author.id, name: fullName(exam.author) } : null,
        isAuthor,
        roomLocked,
        canEdit: isAuthor && !roomLocked,
        sampleObjectKey: exam.sampleObjectKey,
        subjects: visibleSubjects.map((subject) => {
          const resultByStudent = new Map(subject.results.map((row) => [row.studentId, row]));
          const roster = rosterByClass.get(subject.classSubject.classId) ?? [];
          return {
            examSubjectId: subject.id,
            subjectName: subject.classSubject.subject.name,
            classId: subject.classSubject.classId,
            className: subject.classSubject.schoolClass.className,
            examDate: subject.examDate,
            maxMarks: Number(subject.maxMarks),
            passingMarks: subject.passingMarks ? Number(subject.passingMarks) : null,
            gradingScale: subject.gradingScale,
            rows: roster.map((student) => {
              const result = resultByStudent.get(student.studentId);
              return {
                studentId: student.studentId,
                roleNumber: student.roleNumber,
                fullName: student.fullName,
                marks: result?.marks != null ? Number(result.marks) : null,
                grade: result?.grade ?? null,
                remarks: result?.remarks ?? null,
                resultStatus: result?.status ?? null,
              };
            }),
            entered: subject.results.length,
            total: roster.length,
          };
        }),
      };
    });
  }

  /**
   * Teacher-scoped marks entry for one exam subject. Allowed when the teacher
   * authored the exam OR is the assigned subject teacher for this
   * classSubject; marks for other teachers' subjects stay unwritable. Marks
   * may be null: an ABSENT/PERMITTED entry records the remark without a score
   * so averages stay clean.
   */
  async enterMarks(
    tenantId: string,
    userId: string,
    examId: string,
    examSubjectId: string,
    records: { studentId: string; marks?: number | null; remarks?: string }[],
  ) {
    return this.prisma.withTenant(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);

      const examSubject = await db.examSubject.findFirst({
        where: { id: examSubjectId, examId, tenantId },
        include: {
          exam: {
            select: {
              id: true,
              authorId: true,
              academicYearId: true,
              status: true,
              examType: { select: { name: true } },
            },
          },
          classSubject: { select: { id: true, teacherId: true, classId: true } },
          gradingScale: { include: { bands: true } },
        },
      });
      if (!examSubject) throw new NotFoundException('Exam subject not found');

      const isAuthor = examSubject.exam.authorId === userId;
      const isAssigned = examSubject.classSubject.teacherId === teacher.id;
      if (!isAuthor && !isAssigned) {
        throw new ForbiddenException('You can only enter marks for subjects you teach');
      }

      // Submitted marks are locked: only a supervisor return (back to
      // DRAFT) reopens them. This surface serves teachers only, so the
      // lock applies unconditionally here.
      const existing = await db.examResult.findMany({
        where: { examSubjectId, tenantId },
        select: { status: true },
      });
      if (existing.some((row) => row.status !== 'DRAFT')) {
        throw new ForbiddenException(
          'Marks for this subject are submitted and locked. Ask your class supervisor to return them.',
        );
      }

      // Same anti-spoof rule as attendance: only students enrolled in the
      // subject's class may receive a result row.
      const roster = await db.studentEnrollment.findMany({
        where: {
          tenantId,
          classId: examSubject.classSubject.classId,
          academicYearId: examSubject.exam.academicYearId,
          status: 'ACTIVE',
        },
        select: { studentId: true },
      });
      const rosterIds = new Set(roster.map((row) => row.studentId));
      const invalid = records.filter((record) => !rosterIds.has(record.studentId));
      if (invalid.length > 0) {
        throw new BadRequestException(
          `These students are not enrolled in this class: ${invalid.map((r) => r.studentId).join(', ')}`,
        );
      }

      const maxMarks = examSubject.maxMarks.toNumber();
      const results: unknown[] = [];
      for (const record of records) {
        const marks = record.marks ?? null;
        if (marks != null && marks > maxMarks) {
          throw new BadRequestException(
            `Marks for ${record.studentId} exceed the subject maximum (${maxMarks})`,
          );
        }

        let grade: string | null = null;
        if (marks != null && maxMarks > 0 && examSubject.gradingScale) {
          const percentage = (marks / maxMarks) * 100;
          const band = examSubject.gradingScale.bands.find(
            (candidate) =>
              percentage >= candidate.minPercent.toNumber() && percentage <= candidate.maxPercent.toNumber(),
          );
          if (band) grade = band.grade;
        }

        results.push(
          await db.examResult.upsert({
            where: {
              examSubjectId_studentId: {
                examSubjectId: examSubject.id,
                studentId: record.studentId,
              },
            },
            create: {
              tenantId,
              examSubjectId: examSubject.id,
              studentId: record.studentId,
              marks,
              grade,
              remarks: record.remarks,
              submittedBy: userId,
            },
            update: {
              marks,
              grade,
              remarks: record.remarks,
            },
          }),
        );
      }

      // Same release rule as the staff path: TESTs auto-publish on
      // submission, other types only leave DRAFT for MARKS_OPEN.
      await this.exams.applyReleaseRule(db, tenantId, examSubject.exam);

      // Students in this class refetch results on receipt; the payload carries
      // scope only, never the marks themselves.
      await this.realtime.emitDomainEvent({
        kind: 'marks.entered',
        rooms: roomsForTarget('CLASS', examSubject.classSubject.classId),
        payload: { examId, examSubjectId: examSubject.id },
      });

      return { saved: results.length };
    });
  }

  /**
   * Teacher handoff to the class supervisor: flips this subject's DRAFT rows
   * to SUBMITTED (locking them via the enterMarks guard) and notifies the
   * supervisor. Requires every ACTIVE roster student to be marked — no
   * partial handoffs. Idempotent: resubmitting flips zero rows.
   */
  async submitSubjectMarks(tenantId: string, userId: string, examId: string, examSubjectId: string) {
    return this.prisma.withTenant(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);

      const examSubject = await db.examSubject.findFirst({
        where: { id: examSubjectId, examId, tenantId },
        include: {
          exam: { select: { id: true, name: true, authorId: true, academicYearId: true, status: true } },
          classSubject: {
            select: {
              id: true,
              teacherId: true,
              classId: true,
              subject: { select: { name: true } },
              schoolClass: { select: { id: true, className: true, classTeacherId: true } },
            },
          },
        },
      });
      if (!examSubject) throw new NotFoundException('Exam subject not found');

      const isAuthor = examSubject.exam.authorId === userId;
      const isAssigned = examSubject.classSubject.teacherId === teacher.id;
      if (!isAuthor && !isAssigned) {
        throw new ForbiddenException('You can only submit marks for subjects you teach');
      }
      if (examSubject.exam.status === 'PUBLISHED' || examSubject.exam.status === 'CLOSED') {
        throw new ConflictException('This exam is already released and no longer accepts submissions');
      }

      const roster = await db.studentEnrollment.findMany({
        where: {
          tenantId,
          classId: examSubject.classSubject.classId,
          academicYearId: examSubject.exam.academicYearId,
          status: 'ACTIVE',
        },
        select: { studentId: true },
      });
      const marked = await db.examResult.findMany({
        where: { examSubjectId, tenantId, marks: { not: null } },
        select: { studentId: true },
      });
      const markedIds = new Set(marked.map((row) => row.studentId));
      const missing = roster.filter((entry) => !markedIds.has(entry.studentId));
      if (missing.length > 0) {
        throw new UnprocessableEntityException(
          `Cannot submit: ${missing.length} enrolled student${missing.length === 1 ? ' is' : 's are'} still unmarked`,
        );
      }

      const flipped = await db.examResult.updateMany({
        where: { examSubjectId, tenantId, status: 'DRAFT' },
        data: { status: 'SUBMITTED' },
      });

      const supervisorId = examSubject.classSubject.schoolClass.classTeacherId;
      if (supervisorId) {
        const supervisor = await db.teacher.findFirst({
          where: { id: supervisorId, tenantId },
          select: { userId: true },
        });
        if (supervisor?.userId) {
          const subjectName = examSubject.classSubject.subject.name;
          const className = examSubject.classSubject.schoolClass.className;
          await this.notifications.notifyUsers(
            tenantId,
            [supervisor.userId],
            'Marks submitted for review',
            `${subjectName} · ${className} · ${examSubject.exam.name} is ready for your review.`,
            'MARKS_SUBMITTED',
          );
        }
      }

      return { submitted: flipped.count };
    });
  }

  /**
   * Supervisor gate shared by approve/return/queue: the caller must be the
   * class teacher (supervisor) of `classId`. Unassigned classes fail with a
   * clear message instead of an empty result, so the academic office can see
   * the gap rather than silence.
   */
  private async requireSupervisor(
    db: Db,
    tenantId: string,
    teacher: { id: string },
    classId: string,
  ) {
    const schoolClass = await db.schoolClass.findFirst({
      where: { id: classId, tenantId },
      select: { id: true, className: true, classTeacherId: true },
    });
    if (!schoolClass) throw new NotFoundException('Class not found');
    if (schoolClass.classTeacherId !== teacher.id) {
      throw new ForbiddenException(
        schoolClass.classTeacherId
          ? 'Only the assigned class supervisor can review these marks'
          : 'This class has no supervisor assigned yet',
      );
    }
    return schoolClass;
  }

  /** Active userIds holding a staff-admin role in this tenant. */
  private async academicStaffUserIds(db: Db, tenantId: string): Promise<string[]> {
    const links = await db.membershipRole.findMany({
      where: {
        membership: { tenantId, status: 'ACTIVE' },
        role: { slug: { in: ['ADMIN', 'ACADEMIC_ADMIN'] } },
      },
      select: { membership: { select: { userId: true } } },
    });
    return [...new Set(links.map((link) => link.membership.userId))];
  }

  /**
   * Supervisor consolidation: every subject of this class+exam must be fully
   * submitted (all roster students marked, no DRAFT rows) before the approval
   * signal goes to academic affairs. Exam status is owned by academic
   * affairs, so approval never mutates it; idempotent re-approval re-verifies
   * completeness and returns success without re-notifying.
   */
  async approveClassExam(tenantId: string, userId: string, examId: string, classId: string) {
    return this.prisma.withTenant(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const schoolClass = await this.requireSupervisor(db, tenantId, teacher, classId);

      const exam = await db.exam.findFirst({
        where: { id: examId, tenantId },
        select: { id: true, name: true, status: true, academicYearId: true },
      });
      if (!exam) throw new NotFoundException('Exam not found');
      if (exam.status === 'PUBLISHED' || exam.status === 'CLOSED') {
        throw new ConflictException('This exam is already released');
      }

      const subjects = await db.examSubject.findMany({
        where: { examId, tenantId, classSubject: { classId } },
        include: {
          results: { select: { studentId: true, marks: true, status: true } },
          classSubject: { select: { subject: { select: { name: true } } } },
        },
      });
      if (subjects.length === 0) {
        throw new ConflictException('This exam has no subjects in this class');
      }
      const roster = await db.studentEnrollment.findMany({
        where: { tenantId, classId, academicYearId: exam.academicYearId, status: 'ACTIVE' },
        select: { studentId: true },
      });
      for (const subject of subjects) {
        const markedIds = new Set(
          subject.results.filter((row) => row.marks != null).map((row) => row.studentId),
        );
        const unmarked = roster.filter((entry) => !markedIds.has(entry.studentId));
        const draft = subject.results.filter((row) => row.status === 'DRAFT');
        if (unmarked.length > 0 || draft.length > 0) {
          throw new ConflictException(
            `${subject.classSubject.subject.name}: ${unmarked.length} unmarked, ${draft.length} unsubmitted`,
          );
        }
      }

      // Approval is a gate + signal only: exam status ownership belongs to
      // academic affairs, so the supervisor never mutates it.
      const staffUserIds = await this.academicStaffUserIds(db, tenantId);
      await this.notifications.notifyUsers(
        tenantId,
        staffUserIds,
        'Marks ready for review',
        `${exam.name} · ${schoolClass.className} was approved by the supervisor and is waiting for review.`,
        'MARKS_APPROVED',
      );
      return { approved: true };
    });
  }

  /**
   * Supervisor return: SUBMITTED rows of one subject go back to DRAFT with
   * the reason recorded, reopening teacher edits. Exam status is never
   * touched here; academic affairs owns it end to end.
   */
  async returnSubjectMarks(
    tenantId: string,
    userId: string,
    classId: string,
    examSubjectId: string,
    reason: string,
  ) {
    return this.prisma.withTenant(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      await this.requireSupervisor(db, tenantId, teacher, classId);

      const examSubject = await db.examSubject.findFirst({
        where: { id: examSubjectId, tenantId },
        include: {
          exam: { select: { id: true, name: true, authorId: true, status: true } },
          classSubject: {
            select: {
              id: true,
              teacherId: true,
              classId: true,
              subject: { select: { name: true } },
            },
          },
        },
      });
      if (!examSubject || examSubject.classSubject.classId !== classId) {
        throw new NotFoundException('Exam subject not found in this class');
      }

      const supervisorProfile = await db.teacher.findFirst({
        where: { id: teacher.id, tenantId },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      const supervisorUser = supervisorProfile?.user;
      const supervisorName = supervisorUser
        ? [supervisorUser.firstName, supervisorUser.lastName].filter(Boolean).join(' ')
        : null;

      const returned = await db.examResult.updateMany({
        where: { examSubjectId, tenantId, status: 'SUBMITTED' },
        data: { status: 'DRAFT', moderationNote: reason, moderatedByName: supervisorName },
      });

      const recipients = new Set<string>();
      if (examSubject.exam.authorId) recipients.add(examSubject.exam.authorId);
      const assigned = await db.teacher.findFirst({
        where: { id: examSubject.classSubject.teacherId ?? '', tenantId },
        select: { userId: true },
      });
      if (assigned?.userId) recipients.add(assigned.userId);
      recipients.delete(userId);
      await this.notifications.notifyUsers(
        tenantId,
        [...recipients],
        'Marks returned to draft',
        `${examSubject.classSubject.subject.name} · ${examSubject.exam.name}: ${reason}`,
        'MARKS_RETURNED',
      );

      return { returned: returned.count };
    });
  }

  /**
   * Supervisor work queue: every supervised class with its not-yet-released
   * exams, per-subject submitted/total counts, and a ready flag. Classes
   * without a supervisor never appear here — assignment happens elsewhere.
   */
  async listSupervisorQueue(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const supervised = await db.schoolClass.findMany({
        where: { tenantId, classTeacherId: teacher.id },
        select: { id: true, className: true },
      });

      const classes: Array<{
        classId: string;
        className: string;
        exams: QueueExam[];
      }> = [];
      for (const schoolClass of supervised) {
        const subjects = await db.examSubject.findMany({
          where: { tenantId, classSubject: { classId: schoolClass.id } },
          include: {
            exam: {
              select: {
                id: true,
                name: true,
                status: true,
                academicYearId: true,
                examType: { select: { name: true } },
              },
            },
            results: { select: { studentId: true, status: true } },
            classSubject: { select: { subject: { select: { name: true } } } },
          },
        });

        const byExam = new Map<string, { exam: (typeof subjects)[number]['exam']; subjects: typeof subjects }>();
        for (const subject of subjects) {
          const entry = byExam.get(subject.exam.id) ?? { exam: subject.exam, subjects: [] };
          entry.subjects.push(subject);
          byExam.set(subject.exam.id, entry);
        }

        const exams: QueueExam[] = [];
        for (const { exam, subjects: examSubjects } of byExam.values()) {
          if (exam.status === 'PUBLISHED' || exam.status === 'CLOSED') continue;
          if (!examSubjects.some((subject) => subject.results.length > 0)) continue;
          const roster = await db.studentEnrollment.findMany({
            where: {
              tenantId,
              classId: schoolClass.id,
              academicYearId: exam.academicYearId,
              status: 'ACTIVE',
            },
            select: { studentId: true },
          });
          const rosterIds = new Set(roster.map((entry) => entry.studentId));
          const subjectRows = examSubjects.map((subject) => {
            const submittedIds = new Set(
              subject.results.filter((row) => row.status === 'SUBMITTED').map((row) => row.studentId),
            );
            const allSubmitted =
              roster.length > 0 && [...rosterIds].every((id) => submittedIds.has(id));
            return {
              examSubjectId: subject.id,
              subjectName: subject.classSubject.subject.name,
              submitted: submittedIds.size,
              total: roster.length,
              allSubmitted,
            };
          });
          exams.push({
            examId: exam.id,
            examName: exam.name,
            status: exam.status,
            examType: exam.examType?.name ?? null,
            subjects: subjectRows,
            readyToApprove: subjectRows.length > 0 && subjectRows.every((row) => row.allSubmitted),
          });
        }
        classes.push({ classId: schoolClass.id, className: schoolClass.className, exams });
      }
      return { classes };
    });
  }

  // -------------------------------------------------------------------------
  // Students
  // -------------------------------------------------------------------------

  async searchStudents(tenantId: string, userId: string, search?: string, classId?: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const year = await this.currentYear(db, tenantId);
      const myClasses = await this.myClassSubjectIds(db, tenantId, teacher.id);

      if (classId) {
        if (!myClasses.includes(classId)) {
          throw new ForbiddenException('You do not teach this class');
        }
      }

      const term = search?.trim();
      const students = await db.student.findMany({
        where: {
          tenantId,
          enrollments: {
            some: {
              status: 'ACTIVE',
              academicYearId: year.id,
              classId: classId ?? { in: myClasses },
            },
          },
          ...(term
            ? {
                OR: [
                  { firstName: { contains: term, mode: 'insensitive' } },
                  { lastName: { contains: term, mode: 'insensitive' } },
                  { roleNumber: { contains: term, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          roleNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          gender: true,
          grade: true,
          photoUrl: true,
          status: true,
          enrollments: {
            where: { status: 'ACTIVE', academicYearId: year.id },
            select: { schoolClass: { select: { id: true, className: true } } },
          },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 50,
      });

      return {
        students: students.map((student) => ({
          id: student.id,
          roleNumber: student.roleNumber,
          fullName: fullName(student),
          gender: student.gender,
          grade: student.grade,
          photoUrl: student.photoUrl,
          status: student.status,
          classes: student.enrollments.map((enrollment) => enrollment.schoolClass),
        })),
      };
    });
  }

  /** Teacher-scoped student detail: profile, attendance in my classes, results for my subjects. */
  async getStudentDetail(tenantId: string, userId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      const year = await this.currentYear(db, tenantId);
      const myClasses = await this.myClassSubjectIds(db, tenantId, teacher.id);

      const enrollment = await db.studentEnrollment.findFirst({
        where: {
          tenantId,
          studentId,
          academicYearId: year.id,
          status: 'ACTIVE',
          classId: { in: myClasses },
        },
        include: {
          schoolClass: { select: { id: true, className: true, educationLevel: true, grade: true, track: true } },
          student: {
            select: {
              id: true,
              roleNumber: true,
              firstName: true,
              middleName: true,
              lastName: true,
              dateOfBirth: true,
              gender: true,
              phone: true,
              email: true,
              photoUrl: true,
              status: true,
              admissionDate: true,
            },
          },
        },
      });
      // 404, not 403: a student outside this teacher's classes must not be
      // distinguishable from one that does not exist.
      if (!enrollment) throw new NotFoundException('Student not found in your classes');

      const [attendanceRecords, results] = await Promise.all([
        db.attendanceRecord.findMany({
          where: {
            tenantId,
            studentId,
            attendanceSession: { classId: { in: myClasses } },
          },
          include: {
            attendanceSession: {
              select: {
                id: true,
                attendanceDate: true,
                schoolClass: { select: { className: true } },
                subject: { select: { name: true } },
              },
            },
          },
          orderBy: { attendanceSession: { attendanceDate: 'desc' } },
          take: 100,
        }),
        db.examResult.findMany({
          where: {
            tenantId,
            studentId,
            OR: [
              { examSubject: { classSubject: { teacherId: teacher.id } } },
              { examSubject: { exam: { authorId: userId } } },
            ],
          },
          include: {
            examSubject: {
              select: {
                id: true,
                maxMarks: true,
                exam: { select: { id: true, name: true, status: true, publishedAt: true } },
                classSubject: {
                  select: {
                    subject: { select: { name: true } },
                    schoolClass: { select: { className: true } },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ]);

      return {
        student: {
          ...enrollment.student,
          currentClass: enrollment.schoolClass,
        },
        attendance: attendanceRecords.map((record) => ({
          id: record.id,
          date: record.attendanceSession.attendanceDate,
          status: record.status,
          remarks: record.remarks,
          className: record.attendanceSession.schoolClass.className,
          subjectName: record.attendanceSession.subject?.name ?? null,
        })),
        results: results.map((result) => ({
          id: result.id,
          examId: result.examSubject.exam.id,
          examName: result.examSubject.exam.name,
          examStatus: result.examSubject.exam.status,
          publishedAt: result.examSubject.exam.publishedAt,
          subjectName: result.examSubject.classSubject.subject.name,
          className: result.examSubject.classSubject.schoolClass.className,
          marks: result.marks != null ? Number(result.marks) : null,
          maxMarks: Number(result.examSubject.maxMarks),
          grade: result.grade,
          remarks: result.remarks,
          resultStatus: result.status,
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Announcements
  // -------------------------------------------------------------------------

  /**
   * Class-scoped announcement to the parents and students of one of the
   * teacher's own classes. Reuses the admin module's Notification fan-out
   * shape: one row per recipient user, type CLASS_ANNOUNCEMENT.
   */
  async createAnnouncement(tenantId: string, userId: string, dto: CreateTeacherAnnouncementDto) {
    return this.prisma.withTenant(tenantId, async (db) => {
      const teacher = await this.resolveTeacher(db, tenantId, userId);
      await this.assertTeacherClass(db, tenantId, teacher.id, dto.classId);

      const year = await this.currentYear(db, tenantId);
      const enrollments = await db.studentEnrollment.findMany({
        where: { tenantId, classId: dto.classId, academicYearId: year.id, status: 'ACTIVE' },
        select: {
          student: {
            select: {
              userId: true,
              guardians: { select: { guardian: { select: { userId: true } } } },
            },
          },
        },
      });

      const recipientIds = new Set<string>();
      for (const enrollment of enrollments) {
        if (enrollment.student.userId) recipientIds.add(enrollment.student.userId);
        for (const link of enrollment.student.guardians) {
          if (link.guardian.userId) recipientIds.add(link.guardian.userId);
        }
      }

      if (recipientIds.size === 0) {
        throw new ConflictException('No parents or students with accounts are enrolled in this class');
      }

      await db.notification.createMany({
        data: [...recipientIds].map((recipientId) => ({
          tenantId,
          userId: recipientId,
          type: 'CLASS_ANNOUNCEMENT',
          title: dto.title.trim(),
          body: dto.message.trim(),
          channel: 'IN_APP',
        })),
      });

      // Emit to real-time rooms so connected students see it immediately.
      // No row id exists (createMany), so the payload carries the class scope
      // the clients refetch by — events are invalidation signals, not data.
      await this.realtime.emitDomainEvent({
        kind: 'notification.created',
        rooms: roomsForTarget('CLASS', dto.classId),
        payload: { title: dto.title.trim(), classId: dto.classId },
      });

      return { recipients: recipientIds.size };
    });
  }
}
