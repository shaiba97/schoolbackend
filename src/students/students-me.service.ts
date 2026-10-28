import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { FinancePortalService } from '../finance/finance-portal.service';
import { renderResultSlip } from './result-slip';
import { safeUserSelect } from '../common/safe-user.select';
import {
  PerformanceTrendQueryDto,
  TrendMetric,
  TrendWindow,
} from './dto/performance-trend.dto';

type Db = Prisma.TransactionClient | PrismaService;

/** Days spanned by each selectable trend window. */
const WINDOW_DAYS: Record<TrendWindow, number> = {
  week: 7,
  month: 30,
  '3m': 91,
  '6m': 182,
  '1y': 365,
};

/**
 * Below this delta (in percentage points) a trend reads as Stable rather than
 * Improving/Declining, so day-to-day noise is not dressed up as progress.
 */
const STABLE_DELTA = 1;

export type TrendVerdict = 'improving' | 'declining' | 'stable';

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

function verdictFor(delta: number): TrendVerdict {
  if (Math.abs(delta) < STABLE_DELTA) return 'stable';
  return delta > 0 ? 'improving' : 'declining';
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

@Injectable()
export class StudentsMeService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private financePortal: FinancePortalService,
  ) {}

  /**
   * Short-lived credential for the socket handshake.
   *
   * The session JWT lives in an httpOnly cookie that JS cannot read, and
   * cross-origin Lax cookies do not ride a websocket handshake — so the
   * portal exchanges its session for a 10-minute, socket-audience-scoped
   * ticket instead of ever exposing the session token to JS. The gateway
   * verifies the audience, so a stolen ticket is useless for REST calls and
   * expires before it can be replayed far.
   */
  async mintSocketTicket(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      await this.resolveStudent(db, tenantId, userId);
      const ticket = await this.jwt.signAsync(
        { sub: userId, tenantId },
        { expiresIn: '600s', audience: 'socket' },
      );
      return { ticket, expiresIn: 600 };
    });
  }

  // -------------------------------------------------------------------------
  // Shared lookups
  // -------------------------------------------------------------------------

  /**
   * The Student row behind the authenticated user.
   *
   * This is the only place a student identity is established. No endpoint
   * accepts a studentId from the client, so a student cannot read another
   * student's records by tampering with a path parameter or query string.
   */
  private async resolveStudent(db: Db, tenantId: string, userId: string) {
    const student = await db.student.findFirst({
      where: { tenantId, userId },
      select: { id: true, userId: true, roleNumber: true, status: true },
    });
    if (!student) {
      throw new ForbiddenException('No student profile exists for this account in this school');
    }
    if (student.status !== 'ACTIVE') {
      throw new ForbiddenException('This student account is not active');
    }
    return student;
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

  /** The student's ACTIVE enrollment for `yearId`, which names their class. */
  private async activeEnrollment(db: Db, tenantId: string, studentId: string, yearId: string) {
    const enrollment = await db.studentEnrollment.findFirst({
      where: { tenantId, studentId, academicYearId: yearId, status: 'ACTIVE' },
      select: {
        id: true,
        classId: true,
        field: true,
        enrolledOn: true,
        schoolClass: { select: { id: true, className: true, grade: true } },
      },
    });
    if (!enrollment) {
      throw new NotFoundException('You are not enrolled in a class for this academic year');
    }
    return enrollment;
  }

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------

  // GET /students/me/finance — the caller's own fee ledger. Resolves the
  // student from the session exactly like every other self route, then hands
  // the studentId to the shared finance-portal ledger (the accountant view's
  // single source of installment math), so student and accountant always see
  // the same numbers. Guardianship/contact facets of the ledger payload are
  // harmless for self-view; the client renders what it needs.
  async getFinance(tenantId: string, userId: string) {
    const student = await this.prisma.withTenantRead(tenantId, async (db) => {
      return this.resolveStudent(db, tenantId, userId);
    });
    return this.financePortal.getStudentLedger(tenantId, student.id);
  }

  async getProfile(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const student = await this.resolveStudent(db, tenantId, userId);
      const year = await this.currentYear(db, tenantId);
      const enrollment = await this.activeEnrollment(db, tenantId, student.id, year.id);

      const [record, guardians] = await Promise.all([
        db.student.findFirstOrThrow({
          where: { tenantId, id: student.id },
          select: {
            id: true,
            roleNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            gender: true,
            dateOfBirth: true,
            phone: true,
            email: true,
            photoUrl: true,
            educationLevel: true,
            grade: true,
            status: true,
            admissionDate: true,
            user: { select: safeUserSelect },
          },
        }),
        db.studentGuardian.findMany({
          where: { tenantId, studentId: student.id },
          select: {
            relationship: true,
            isPrimary: true,
            canPickup: true,
            emergencyContact: true,
            guardian: {
              select: {
                id: true,
                guardianNumber: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
          orderBy: [{ isPrimary: 'desc' }, { guardian: { lastName: 'asc' } }],
        }),
      ]);

      return {
        student: {
          ...record,
          fullName: [record.firstName, record.middleName, record.lastName]
            .filter(Boolean)
            .join(' '),
        },
        year: { id: year.id, name: year.name },
        class: {
          id: enrollment.schoolClass.id,
          className: enrollment.schoolClass.className,
          grade: enrollment.schoolClass.grade,
        },
        field: enrollment.field,
        guardians: guardians.map((link) => ({
          relationship: link.relationship,
          isPrimary: link.isPrimary,
          canPickup: link.canPickup,
          emergencyContact: link.emergencyContact,
          ...link.guardian,
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Timetable
  // -------------------------------------------------------------------------

  async getTimetable(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const student = await this.resolveStudent(db, tenantId, userId);
      return this.timetableForStudent(db, tenantId, student.id);
    });
  }

  /**
   * Class timetable for one student id, shared by the self view and the
   * guardian ward view. Scoped by the student's ACTIVE enrollment — never
   * from the request.
   */
  async timetableForStudent(db: Db, tenantId: string, studentId: string) {
    const year = await this.currentYear(db, tenantId);
    const enrollment = await this.activeEnrollment(db, tenantId, studentId, year.id);

    const entries = await db.timetableEntry.findMany({
      where: {
        tenantId,
        classId: enrollment.classId,
        academicYearId: year.id,
        timetableType: 'REGULAR',
      },
      include: {
        subject: { select: { id: true, name: true } },
        teacher: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }, { periodNo: 'asc' }],
    });

    // Distinct subjects assigned to the class with their teachers, so the
    // portal can list "who teaches what" without inferring it from periods.
    // Unassigned subjects stay in the list with a null teacher rather than
    // vanishing. Same enrollment classId scoping as the entries above.
    const assignments = await db.classSubject.findMany({
      where: { tenantId, classId: enrollment.classId },
      select: {
        subject: { select: { id: true, name: true } },
        teacher: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { subject: { name: 'asc' } },
    });

    return {
      year: { id: year.id, name: year.name },
      class: {
        id: enrollment.schoolClass.id,
        className: enrollment.schoolClass.className,
      },
      subjects: assignments.map((assignment) => ({
        subjectId: assignment.subject.id,
        subjectName: assignment.subject.name,
        teacherName: assignment.teacher
          ? [assignment.teacher.user.firstName, assignment.teacher.user.lastName]
              .filter(Boolean)
              .join(' ')
          : null,
      })),
      entries: entries.map((entry) => ({
        id: entry.id,
        dayOfWeek: entry.dayOfWeek,
        periodNo: entry.periodNo,
        startTime: entry.startTime,
        endTime: entry.endTime,
        isBreak: entry.isBreak,
        room: entry.room,
        subjectId: entry.subjectId,
        subjectName: entry.subject?.name ?? null,
        teacherName: entry.teacher
          ? [entry.teacher.user.firstName, entry.teacher.user.lastName]
              .filter(Boolean)
              .join(' ')
          : null,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  /**
   * Only PUBLISHED exams are visible. Publish is ADMIN-only, so this is the
   * real gate: without it a student would see DRAFT results and marks that
   * teachers have not released yet.
   */
  async getResults(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const student = await this.resolveStudent(db, tenantId, userId);
      return this.resultsForStudent(db, tenantId, student.id);
    });
  }

  /**
   * Published results for one student id, shared by the self view and the
   * guardian ward view. The PUBLISHED gate lives here, so every consumer
   * inherits it.
   */
  async resultsForStudent(db: Db, tenantId: string, studentId: string) {
    const results = await db.examResult.findMany({
      where: {
        tenantId,
        studentId,
        examSubject: { exam: { status: 'PUBLISHED' } },
      },
      select: {
        id: true,
        marks: true,
        grade: true,
        status: true,
        kind: true,
        createdAt: true,
        examSubject: {
          select: {
            id: true,
            maxMarks: true,
            examDate: true,
            exam: { select: { id: true, name: true, examType: { select: { name: true } } } },
            classSubject: {
              select: {
                subject: { select: { id: true, name: true } },
                schoolClass: { select: { className: true } },
              },
            },
          },
        },
      },
      orderBy: { examSubject: { examDate: 'desc' } },
      take: 500,
    });

    const rows = results.map((result) => {
      const max = Number(result.examSubject.maxMarks);
      const marks = result.marks === null ? null : Number(result.marks);
      return {
        id: result.id,
        examId: result.examSubject.exam.id,
        examName: result.examSubject.exam.name,
        examType: result.examSubject.exam.examType?.name ?? null,
        examDate: result.examSubject.examDate,
        subjectId: result.examSubject.classSubject.subject.id,
        subjectName: result.examSubject.classSubject.subject.name,
        className: result.examSubject.classSubject.schoolClass.className,
        marks,
        maxMarks: max,
        percentage: marks !== null && max > 0 ? round1((marks / max) * 100) : null,
        grade: result.grade,
        status: result.status,
      };
    });

    const scored = rows.filter((row) => row.percentage !== null);
    const average = scored.length
      ? round1(scored.reduce((sum, row) => sum + (row.percentage as number), 0) / scored.length)
      : null;

    return { results: rows, averagePercentage: average, count: rows.length };
  }

  /**
   * Printable result slip for one published exam. The exam must be PUBLISHED —
   * same gate as `getResults` — and the 404 is deliberately indistinguishable
   * from a missing exam, so an unpublished exam cannot be probed by id.
   */
  async getResultPdf(tenantId: string, userId: string, examId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const student = await this.resolveStudent(db, tenantId, userId);

      const exam = await db.exam.findFirst({
        where: { id: examId, tenantId, status: 'PUBLISHED' },
        select: {
          id: true,
          name: true,
          startsOn: true,
          examType: { select: { name: true } },
        },
      });
      if (!exam) throw new NotFoundException('Exam not found');

      const [profile, results] = await Promise.all([
        db.student.findFirstOrThrow({
          where: { id: student.id, tenantId },
          select: {
            roleNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            enrollments: {
              where: { status: 'ACTIVE' },
              orderBy: { enrolledOn: 'desc' },
              take: 1,
              select: { schoolClass: { select: { className: true } } },
            },
          },
        }),
        db.examResult.findMany({
          where: { tenantId, studentId: student.id, examSubject: { examId } },
          select: {
            marks: true,
            grade: true,
            examSubject: {
              select: {
                maxMarks: true,
                classSubject: { select: { subject: { select: { name: true } } } },
              },
            },
          },
          orderBy: { examSubject: { classSubject: { subject: { name: 'asc' } } } },
        }),
      ]);

      const rows = results.map((row) => {
        const max = Number(row.examSubject.maxMarks);
        const marks = row.marks === null ? null : Number(row.marks);
        return {
          subject: row.examSubject.classSubject.subject.name,
          marks,
          max,
          grade: row.grade ?? '—',
        };
      });
      const scored = rows.filter((row) => row.marks !== null);
      const average =
        scored.length > 0
          ? round1(scored.reduce((sum, row) => sum + ((row.marks as number) / row.max) * 100, 0) / scored.length)
          : null;

      const fullName = [profile.firstName, profile.middleName, profile.lastName]
        .filter(Boolean)
        .join(' ');
      const buffer = await renderResultSlip({
        examName: exam.name,
        examType: exam.examType?.name ?? 'Exam',
        examDate: exam.startsOn,
        studentName: fullName,
        roleNumber: profile.roleNumber,
        className: profile.enrollments[0]?.schoolClass.className ?? '—',
        rows,
        average,
      });

      const filename = `${exam.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'result'}-${profile.roleNumber}.pdf`;
      return { filename, buffer };
    });
  }

  // -------------------------------------------------------------------------
  // Attendance
  // -------------------------------------------------------------------------

  /**
   * Attendance percentage counts PRESENT and LATE as attended, matching the
   * rule already documented in the academic portal's student attendance tab.
   */
  private summarise(records: Array<{ status: string }>) {
    const counts = { present: 0, absent: 0, late: 0, excused: 0, other: 0 };
    for (const record of records) {
      switch (record.status) {
        case 'PRESENT':
          counts.present += 1;
          break;
        case 'ABSENT':
          counts.absent += 1;
          break;
        case 'LATE':
          counts.late += 1;
          break;
        case 'EXCUSED':
          counts.excused += 1;
          break;
        default:
          counts.other += 1;
      }
    }
    const total = records.length;
    const attended = counts.present + counts.late;
    return {
      ...counts,
      total,
      attended,
      percentage: total ? round1((attended / total) * 100) : null,
    };
  }

  async getAttendance(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const student = await this.resolveStudent(db, tenantId, userId);
      return this.attendanceForStudent(db, tenantId, student.id);
    });
  }

  /**
   * Attendance for one student id, shared by the self view and the guardian
   * ward view. Filtered by the resolved student id — never from the request.
   */
  async attendanceForStudent(db: Db, tenantId: string, studentId: string) {
      const records = await db.attendanceRecord.findMany({
        where: { tenantId, studentId },
        select: {
          id: true,
          status: true,
          markedAt: true,
          attendanceSession: {
            select: {
              attendanceDate: true,
              subject: { select: { name: true } },
              schoolClass: { select: { className: true } },
            },
          },
        },
        orderBy: { attendanceSession: { attendanceDate: 'desc' } },
        take: 1000,
      });

      const rows = records.map((record) => ({
        id: record.id,
        date: dayKey(record.attendanceSession.attendanceDate),
        status: record.status,
        subjectName: record.attendanceSession.subject?.name ?? null,
        className: record.attendanceSession.schoolClass?.className ?? null,
      }));

      return { summary: this.summarise(records), records: rows };
  }

  // -------------------------------------------------------------------------
  // Cases
  // -------------------------------------------------------------------------

  /**
   * All cases filed against this student, newest first. A student sees
   * OPEN, UNDER_REVIEW, RESOLVED and DISMISSED — hiding an active case from
   * the person it concerns would cause more confusion than showing it.
   */
  async getCases(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const student = await this.resolveStudent(db, tenantId, userId);
      return this.casesForStudent(db, tenantId, student.id);
    });
  }

  /**
   * Cases for one student id, shared by the self view and the guardian ward
   * view. Guardians see every status — an active case concerning their child
   * is not hidden from them.
   */
  async casesForStudent(db: Db, tenantId: string, studentId: string) {
      const cases = await db.studentCase.findMany({
        where: { tenantId, studentId },
        select: {
          id: true,
          title: true,
          description: true,
          severity: true,
          status: true,
          filedAt: true,
          resolvedAt: true,
          resolutionNote: true,
          filedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { filedAt: 'desc' },
        take: 100,
      });

      return {
        cases: cases.map((c) => ({
          id: c.id,
          title: c.title,
          description: c.description,
          severity: c.severity,
          status: c.status,
          filedAt: c.filedAt,
          resolvedAt: c.resolvedAt,
          resolutionNote: c.resolutionNote,
          filedByName: [c.filedBy.firstName, c.filedBy.lastName].filter(Boolean).join(' '),
        })),
      };
  }

  // -------------------------------------------------------------------------
  // Performance trend
  // -------------------------------------------------------------------------

  /**
   * Pre-aggregated averages for the selected window and the immediately
   * preceding equal-length window. The client never receives the raw history
   * to average itself, so this stays cheap as years of results accumulate.
   */
  async getPerformanceTrend(tenantId: string, userId: string, query: PerformanceTrendQueryDto) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const student = await this.resolveStudent(db, tenantId, userId);
      return this.trendForStudent(db, tenantId, student.id, query);
    });
  }

  /**
   * Performance trend for one student id, shared by the self view and the
   * guardian ward view.
   */
  async trendForStudent(
    db: Db,
    tenantId: string,
    studentId: string,
    query: PerformanceTrendQueryDto,
  ) {
      const days = WINDOW_DAYS[query.window];
      const now = new Date();
      const currentStart = subtractDays(now, days);
      const priorStart = subtractDays(now, days * 2);

      if (query.metric === 'results') {
        const rows = await db.examResult.findMany({
          where: {
            tenantId,
            studentId,
            examSubject: { exam: { status: 'PUBLISHED' } },
          },
          select: {
            createdAt: true,
            marks: true,
            examSubject: {
              select: {
                maxMarks: true,
                exam: { select: { examType: { select: { name: true } } } },
                classSubject: { select: { subject: { select: { name: true } } } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 1000,
        });

        const points = rows
          .map((row) => {
            const max = Number(row.examSubject.maxMarks);
            const marks = row.marks === null ? null : Number(row.marks);
            if (marks === null || max <= 0) return null;
            const examTypeName = row.examSubject.exam?.examType?.name;
            const group: string =
              examTypeName?.trim().toLowerCase() === 'test' ? 'test' : 'exam';
            return {
              at: dayKey(row.createdAt),
              value: round1((marks / max) * 100),
              label: row.examSubject.classSubject.subject.name,
              group,
            };
          })
          .filter(
            (
              row,
            ): row is {
              at: string;
              value: number;
              label: string;
              group: string;
            } => row !== null,
          );

        return this.trendResponse(query, points, days, now, currentStart, priorStart);
      }

      const records = await db.attendanceRecord.findMany({
        where: {
          tenantId,
          studentId,
          attendanceSession: { attendanceDate: { gte: priorStart } },
        },
        select: {
          status: true,
          attendanceSession: { select: { attendanceDate: true } },
        },
        take: 2000,
      });

      const points = records.map((record) => ({
        at: dayKey(record.attendanceSession.attendanceDate),
        attended: record.status === 'PRESENT' || record.status === 'LATE' ? 1 : 0,
      }));

      return this.trendResponse(query, points, days, now, currentStart, priorStart);
  }

  /**
   * Shared window maths for both metrics so the two can never disagree about
   * what "current window" or "Stable" means.
   */
  private trendResponse(
    query: PerformanceTrendQueryDto,
    points: Array<{
      at: string;
      value?: number;
      attended?: number;
      group?: string;
    }>,
    days: number,
    now: Date,
    currentStart: Date,
    priorStart: Date,
  ) {
    const inWindow = (at: string, from: Date, to: Date) => {
      const day = new Date(`${at}T00:00:00.000Z`);
      return day >= from && day < to;
    };

    const valueOf = (point: { value?: number; attended?: number }) =>
      query.metric === 'results' ? (point.value as number) : (point.attended as number);

    const current = points.filter((p) => inWindow(p.at, currentStart, now));
    const prior = points.filter((p) => inWindow(p.at, priorStart, currentStart));

    const averageOf = (list: typeof points) =>
      list.length ? list.reduce((sum, p) => sum + valueOf(p), 0) / list.length : null;

    // Attendance averages a 0/1 attendance ratio per session, so scale to a
    // percentage to keep both metrics in the same 0-100 units.
    const scale = query.metric === 'attendance' ? 100 : 1;
    const currentAvg = averageOf(current);
    const priorAvg = averageOf(prior);

    const currentValue = currentAvg === null ? null : round1(currentAvg * scale);
    const priorValue = priorAvg === null ? null : round1(priorAvg * scale);
    const delta =
      currentValue === null || priorValue === null ? null : round1(currentValue - priorValue);

    // Test/Exam split of the current window only: the headline trend above
    // compares windows, while this answers "tests vs exams right now".
    // Points without a group (attendance, legacy shapes) land in neither
    // bucket, so both report empty rather than misattributed.
    const bucketOf = (group: string) => {
      const list = current.filter((point) => point.group === group);
      const average = averageOf(list);
      return {
        average: average === null ? null : round1(average * scale),
        samples: list.length,
      };
    };

    return {
      metric: query.metric,
      window: query.window,
      windowDays: days,
      current: {
        from: dayKey(currentStart),
        to: dayKey(now),
        average: currentValue,
        samples: current.length,
      },
      previous: {
        from: dayKey(priorStart),
        to: dayKey(currentStart),
        average: priorValue,
        samples: prior.length,
      },
      delta,
      verdict: delta === null ? null : verdictFor(delta),
      byType: { test: bucketOf('test'), exam: bucketOf('exam') },
      series: [...current]
        .reverse()
        .map((point) =>
          query.metric === 'results'
            ? { at: point.at, value: point.value ?? null }
            : { at: point.at, value: (point.attended ?? 0) * 100 },
        ),
    };
  }
}