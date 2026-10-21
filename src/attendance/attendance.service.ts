import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway, roomsForTarget } from '../realtime/realtime.gateway';
import {
  CreateAttendanceSessionDto,
  BulkMarkAttendanceDto,
} from './dto/attendance.dto';
import {
  ATTENDANCE_EDIT_WINDOW_DAYS,
  canEditAttendance,
  localDateKey,
  storedDateKey,
} from '../common/attendance-window.util';

/** Authenticated caller; roles come from the tenant context. */
export interface AttendanceActor {
  userId: string;
  roles?: string[];
}

function isTeacherOnly(actor?: AttendanceActor): boolean {
  if (!actor) return false;
  const roles = actor.roles ?? [];
  return roles.includes('TEACHER') && !roles.includes('ADMIN') && !roles.includes('ACADEMIC_ADMIN');
}

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  /** A teacher-only actor must already teach the class (ClassSubject). */
  private async assertTeacherOwnsClass(
    tx: any,
    tenantId: string,
    userId: string,
    classId: string,
    label: string,
  ) {
    const assignment = await tx.classSubject.findFirst({
      where: { tenantId, classId, teacher: { userId } },
      select: { id: true, teacherId: true },
    });
    if (!assignment) {
      throw new ForbiddenException(`You do not teach this ${label}`);
    }
    return assignment;
  }

  private assertEditWindow(attendanceDate: Date) {
    const todayKey = localDateKey(new Date());
    const dateKey = storedDateKey(attendanceDate);
    if (dateKey > todayKey) {
      throw new BadRequestException('Attendance cannot be recorded for a future date');
    }
    if (!canEditAttendance(dateKey, todayKey)) {
      throw new ForbiddenException(
        `Attendance is locked: the edit window is ${ATTENDANCE_EDIT_WINDOW_DAYS} days`,
      );
    }
  }

  async createSession(tenantId: string, dto: CreateAttendanceSessionDto, actor?: AttendanceActor) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const schoolClass = await tx.schoolClass.findFirst({
        where: { id: dto.classId, tenantId },
      });
      if (!schoolClass) throw new NotFoundException('Class not found');

      if (isTeacherOnly(actor)) {
        await this.assertTeacherOwnsClass(tx, tenantId, actor!.userId, dto.classId, 'class');
        this.assertEditWindow(new Date(dto.date));
      }

      const existing = await tx.attendanceSession.findFirst({
        where: {
          tenantId,
          classId: dto.classId,
          attendanceDate: new Date(dto.date),
        },
      });
      if (existing) {
        throw new ConflictException('Attendance session already exists for this class and date');
      }

      let teacherId: string | undefined;
      if (actor && isTeacherOnly(actor)) {
        teacherId = (
          (await tx.teacher.findFirst({
            where: { tenantId, userId: actor.userId },
            select: { id: true },
          })) as { id: string } | null
        )?.id;
      }

      return tx.attendanceSession.create({
        data: {
          tenantId,
          classId: dto.classId,
          subjectId: dto.subjectId,
          teacherId,
          attendanceDate: new Date(dto.date),
        },
        include: { schoolClass: true },
      });
    });
  }

  async findSession(tenantId: string, sessionId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const session = await tx.attendanceSession.findFirst({
        where: { id: sessionId, tenantId },
        include: {
          schoolClass: true,
          records: {
            include: { student: true },
          },
        },
      });
      if (!session) throw new NotFoundException('Attendance session not found');
      return session;
    });
  }

  async findByClassAndDate(tenantId: string, classId: string, date: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.attendanceSession.findFirst({
        where: {
          tenantId,
          classId,
          attendanceDate: new Date(date),
        },
        include: {
          records: {
            include: { student: true },
            orderBy: { student: { firstName: 'asc' } },
          },
        },
      }),
    );
  }

  async markBulk(tenantId: string, sessionId: string, dto: BulkMarkAttendanceDto, actor?: AttendanceActor) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const session = await tx.attendanceSession.findFirst({
        where: { id: sessionId, tenantId },
      });
      if (!session) throw new NotFoundException('Attendance session not found');

      if (isTeacherOnly(actor)) {
        await this.assertTeacherOwnsClass(tx, tenantId, actor!.userId, session.classId, "session's class");
        this.assertEditWindow(session.attendanceDate);
      }

      // Only students enrolled in the session's class may be marked: a
      // spoofed studentId must not create attendance history elsewhere.
      // Admins keep the previous permissive behavior for backfill workflows.
      if (isTeacherOnly(actor)) {
        const year = await tx.academicYear.findFirst({
          where: {
            tenantId,
            startsOn: { lte: session.attendanceDate },
            endsOn: { gte: session.attendanceDate },
          },
          orderBy: { startsOn: 'desc' },
          select: { id: true },
        });
        const roster = await tx.studentEnrollment.findMany({
          where: {
            tenantId,
            classId: session.classId,
            status: 'ACTIVE',
            ...(year ? { academicYearId: year.id } : {}),
          },
          select: { studentId: true },
        });
        const rosterIds = new Set(roster.map((row) => row.studentId));
        const invalid = dto.records.filter((record) => !rosterIds.has(record.studentId));
        if (invalid.length > 0) {
          throw new BadRequestException(
            `These students are not enrolled in this class: ${invalid.map((r) => r.studentId).join(', ')}`,
          );
        }
      }

      const results: any[] = [];
      for (const record of dto.records) {
        const upserted = await tx.attendanceRecord.upsert({
          where: {
            attendanceSessionId_studentId: {
              attendanceSessionId: sessionId,
              studentId: record.studentId,
            },
          },
          create: {
            tenantId,
            attendanceSessionId: sessionId,
            studentId: record.studentId,
            status: record.status as any,
            remarks: record.remarks,
          },
          update: {
            status: record.status as any,
            remarks: record.remarks,
          },
        });
        results.push(upserted);
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

      return results;
    });
  }

  async getStudentAttendance(tenantId: string, studentId: string, yearId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const year = await tx.academicYear.findFirst({
        where: { id: yearId, tenantId },
      });
      if (!year) throw new NotFoundException('Academic year not found');

      const from = new Date(year.startsOn);
      from.setHours(0, 0, 0, 0);
      const to = new Date(year.endsOn);
      to.setHours(23, 59, 59, 999);

      const enrollment = await tx.studentEnrollment.findFirst({
        where: {
          studentId,
          academicYearId: yearId,
          tenantId,
          status: 'ACTIVE',
        },
      });

      let total = 0;
      let present = 0;

      if (enrollment) {
        total = await tx.attendanceSession.count({
          where: {
            tenantId,
            classId: enrollment.classId,
            attendanceDate: { gte: from, lte: to },
          },
        });

        present = await tx.attendanceRecord.count({
          where: {
            tenantId,
            studentId,
            status: { in: ['PRESENT', 'LATE'] },
            // The relation on AttendanceRecord is `attendanceSession`; a
            // `session` key is rejected by Prisma at runtime with
            // "Unknown argument".
            attendanceSession: {
              classId: enrollment.classId,
              attendanceDate: { gte: from, lte: to },
            },
          },
        });
      }

      return {
        total,
        present,
        percentage: total > 0 ? Math.round((present / total) * 100) : 0,
      };
    });
  }

  async getToday(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.attendanceSession.findMany({
        where: {
          tenantId,
          attendanceDate: { gte: today, lt: tomorrow },
        },
        include: {
          schoolClass: true,
          _count: { select: { records: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Read-only member/day matrix over a date range for admin views: every
   * attendance record in [from, to] (optionally scoped to one class),
   * flattened with the class and student identity. Rows are sorted by
   * attendanceDate, then class name, then student name.
   */
  async listMatrix(
    tenantId: string,
    query: { from: string; to: string; classId?: string },
  ) {
    const from = new Date(query.from);
    const to = new Date(`${query.to}T23:59:59.999Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException('date range must satisfy from <= to');
    }
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const records = await tx.attendanceRecord.findMany({
        where: {
          tenantId,
          attendanceSession: {
            tenantId,
            ...(query.classId ? { classId: query.classId } : {}),
            attendanceDate: { gte: from, lte: to },
          },
        },
        include: {
          student: {
            select: { id: true, firstName: true, lastName: true, roleNumber: true },
          },
          attendanceSession: {
            select: {
              id: true,
              classId: true,
              attendanceDate: true,
              schoolClass: { select: { className: true } },
            },
          },
        },
      });
      const rows = records.map((record: any) => ({
        attendanceDate: storedDateKey(record.attendanceSession.attendanceDate),
        classId: record.attendanceSession.classId,
        className: record.attendanceSession.schoolClass?.className ?? '',
        studentId: record.student.id,
        studentName: `${record.student.firstName} ${record.student.lastName}`.trim(),
        rollNumber: record.student.roleNumber,
        status: record.status,
        remarks: record.remarks,
      }));
      rows.sort(
        (a: any, b: any) =>
          a.attendanceDate.localeCompare(b.attendanceDate) ||
          a.className.localeCompare(b.className) ||
          a.studentName.localeCompare(b.studentName),
      );
      return rows;
    });
  }
}
