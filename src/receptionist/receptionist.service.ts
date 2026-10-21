import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway, roomsForTarget } from '../realtime/realtime.gateway';
import { StaffAttendanceService } from '../staff-attendance/staff-attendance.service';
import {
  OPERATIONAL_POSITION_SLUGS,
  SYSTEM_POSITION_SLUGS,
  CUSTOM_ROLE_PREFIX,
  positionTitleFor,
} from '../staff/staff.service';
import { AttendanceService } from '../attendance/attendance.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface AttendanceRow {
  entityId: string;
  fullName: string;
  idLabel: string;
  contextLabel: string;
  status:
    'PRESENT' | 'LATE' | 'ABSENT' | 'PERMITTED' | 'EXCUSED' | 'LEAVE' | null;
}

export interface MarkAttendanceResult {
  entityId: string;
  entityType: 'staff' | 'teacher' | 'student';
  status: string;
  date: string;
}

@Injectable()
export class ReceptionistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeGateway,
    private readonly staffAttendanceService: StaffAttendanceService,
    private readonly attendanceService: AttendanceService,
  ) {}

  mapStatusForEntity(
    entityType: 'staff' | 'teacher' | 'student',
    status: string,
  ): string {
    if (entityType === 'student' && status === 'PERMITTED') {
      return 'EXCUSED';
    }
    return status;
  }

  async getProfile(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const user = await db.user.findFirst({
        where: { id: userId, status: { not: 'DELETED' } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          staffNumber: true,
          phone: true,
          email: true,
          memberships: {
            where: { tenantId, status: 'ACTIVE' },
            select: {
              roles: {
                select: { role: { select: { slug: true } } },
              },
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const isReceptionist = user.memberships.some((m) =>
        m.roles.some((r) => r.role.slug === 'RECEPTIONIST'),
      );
      if (!isReceptionist) {
        throw new NotFoundException('No receptionist profile found');
      }

      return {
        firstName: user.firstName,
        lastName: user.lastName,
        staffNumber: user.staffNumber,
        phone: user.phone,
        email: user.email,
        role: 'RECEPTIONIST' as const,
        department: undefined,
      };
    });
  }

  async getAttendanceList(
    tenantId: string,
    type: 'staff' | 'teacher' | 'student',
    date: string,
  ): Promise<{ rows: AttendanceRow[] }> {
    const targetDate = new Date(date);

    if (type === 'staff') {
      return this.getStaffAttendanceList(tenantId, targetDate);
    }
    if (type === 'teacher') {
      return this.getTeacherAttendanceList(tenantId, targetDate);
    }
    if (type === 'student') {
      return this.getStudentAttendanceList(tenantId, targetDate);
    }
    throw new BadRequestException('Invalid type');
  }

  private async getStaffAttendanceList(
    tenantId: string,
    date: Date,
  ): Promise<{ rows: AttendanceRow[] }> {
    const [staffList, attendanceRows] = await Promise.all([
      this.prisma.withTenantRead(tenantId, (db) =>
        db.user.findMany({
          where: {
            status: { not: 'DELETED' },
            memberships: {
              some: {
                tenantId,
                status: 'ACTIVE',
                roles: {
                  some: {
                    role: {
                      OR: [
                        {
                          slug: {
                            in: [
                              ...SYSTEM_POSITION_SLUGS,
                              ...OPERATIONAL_POSITION_SLUGS,
                            ],
                          },
                        },
                        { slug: { startsWith: CUSTOM_ROLE_PREFIX } },
                      ],
                    },
                  },
                },
              },
            },
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            staffNumber: true,
            phone: true,
            memberships: {
              where: { tenantId, status: 'ACTIVE' },
              select: {
                roles: {
                  select: { role: { select: { slug: true, name: true } } },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
      ),
      this.prisma.withTenantRead(tenantId, (db) =>
        db.staffMemberAttendance.findMany({
          where: { tenantId, attendanceDate: date },
          select: { userId: true, status: true },
        }),
      ),
    ]);

    const attendanceMap = new Map(
      attendanceRows.map((a) => [a.userId, a.status]),
    );

    const rows: AttendanceRow[] = staffList.map((user) => {
      const primaryRole = user.memberships?.[0]?.roles?.[0]?.role;
      const contextLabel = primaryRole
        ? positionTitleFor(primaryRole.slug, primaryRole.name)
        : 'Staff';
      return {
        entityId: user.id,
        fullName: this.fullNameOf([user.firstName, user.lastName]),
        idLabel: user.staffNumber ?? '—',
        contextLabel,
        status: attendanceMap.get(user.id) ?? null,
      };
    });

    return { rows };
  }

  /** Joins every stored name part verbatim — no first/middle/last structure assumed. */
  private fullNameOf(parts: Array<string | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
  }

  private async getTeacherAttendanceList(
    tenantId: string,
    date: Date,
  ): Promise<{ rows: AttendanceRow[] }> {
    const [teacherList, attendanceRows] = await Promise.all([
      this.prisma.withTenantRead(tenantId, (db) =>
        db.teacher.findMany({
          where: { tenantId, status: { not: 'TERMINATED' } },
          include: {
            user: { select: { firstName: true, lastName: true } },
            department: { select: { name: true } },
          },
          orderBy: { user: { createdAt: 'asc' } },
        }),
      ) as Promise<
        Array<{
          id: string;
          employeeNumber: string | null;
          specialization: string | null;
          department: { name: string } | null;
          user: { firstName: string; lastName: string };
        }>
      >,
      this.prisma.withTenantRead(tenantId, (db) =>
        db.staffAttendance.findMany({
          where: { tenantId, attendanceDate: date },
          select: { teacherId: true, status: true },
        }),
      ),
    ]);

    const attendanceMap = new Map(
      attendanceRows.map((a) => [a.teacherId, a.status]),
    );

    const rows: AttendanceRow[] = teacherList.map((teacher) => ({
      entityId: teacher.id,
      fullName: this.fullNameOf([teacher.user.firstName, teacher.user.lastName]),
      idLabel: teacher.employeeNumber ?? '—',
      contextLabel:
        teacher.specialization ?? teacher.department?.name ?? '—',
      status: attendanceMap.get(teacher.id) ?? null,
    }));

    return { rows };
  }

  private async getStudentAttendanceList(
    tenantId: string,
    date: Date,
  ): Promise<{ rows: AttendanceRow[] }> {
    const currentYear = await this.prisma.withTenantRead(tenantId, (db) =>
      db.academicYear.findFirst({
        where: { tenantId, isCurrent: true },
        select: { id: true },
      }),
    );
    if (!currentYear) {
      return { rows: [] };
    }

    const sessions = await this.prisma.withTenantRead(tenantId, (db) =>
      db.attendanceSession.findMany({
        where: { tenantId, attendanceDate: date },
        select: { id: true, classId: true },
      }),
    );
    const sessionIds = sessions.map((s) => s.id);

    let attendanceMap = new Map<string, string>();
    if (sessionIds.length > 0) {
      const records = await this.prisma.withTenantRead(tenantId, (db) =>
        db.attendanceRecord.findMany({
          where: { tenantId, attendanceSessionId: { in: sessionIds } },
          select: { studentId: true, status: true },
        }),
      );
      attendanceMap = new Map(records.map((r) => [r.studentId, r.status]));
    }

    const students = await this.prisma.withTenantRead(tenantId, (db) =>
      db.student.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          enrollments: {
            some: { academicYearId: currentYear.id, status: 'ACTIVE' },
          },
        },
        include: {
          enrollments: {
            where: { academicYearId: currentYear.id, status: 'ACTIVE' },
            take: 1,
            include: { schoolClass: { select: { className: true } } },
          },
        },
        orderBy: { firstName: 'asc' },
      }),
    );

    const rows: AttendanceRow[] = students.map((student) => {
      const enrollment = student.enrollments[0];
      const className = enrollment?.schoolClass?.className ?? '—';
      return {
        entityId: student.id,
        fullName: this.fullNameOf([
          student.firstName,
          student.middleName,
          student.lastName,
        ]),
        idLabel: student.roleNumber,
        contextLabel: className,
        status: (attendanceMap.get(student.id) ??
          null) as AttendanceRow['status'],
      };
    });

    return { rows };
  }

  async markAttendance(
    tenantId: string,
    markedById: string,
    dto: {
      entityType: 'staff' | 'teacher' | 'student';
      entityId: string;
      status: string;
      date: string;
      remarks?: string;
    },
  ): Promise<MarkAttendanceResult> {
    const { entityType, entityId, status, date, remarks } = dto;
    const targetDate = new Date(date);

    if (entityType === 'staff') {
      await this.staffAttendanceService.upsertMemberEntries(
        tenantId,
        markedById,
        {
          date,
          entries: [
            {
              userId: entityId,
              status: this.mapStatusForEntity('staff', status),
              remarks,
            },
          ],
        },
      );
    } else if (entityType === 'teacher') {
      await this.staffAttendanceService.upsertEntries(tenantId, markedById, {
        date,
        entries: [
          {
            teacherId: entityId,
            status: this.mapStatusForEntity('teacher', status),
            remarks,
          },
        ],
      });
    } else if (entityType === 'student') {
      await this.markStudentAttendance(
        tenantId,
        entityId,
        status,
        targetDate,
        remarks,
      );
    } else {
      throw new BadRequestException('Invalid entityType');
    }

    this.realtime.emitDomainEvent({
      kind: 'attendance_updated',
      rooms: roomsForTarget('SCHOOL_WIDE', null),
      payload: {
        entityType,
        entityId,
        status: this.mapStatusForEntity(entityType, status),
        date,
      },
    });

    return {
      entityId,
      entityType,
      status: this.mapStatusForEntity(entityType, status),
      date,
    };
  }

  private async markStudentAttendance(
    tenantId: string,
    studentId: string,
    status: string,
    date: Date,
    remarks?: string,
  ): Promise<void> {
    const enrollment = await this.prisma.withTenantRead(tenantId, (db) =>
      db.studentEnrollment.findFirst({
        where: { tenantId, studentId, status: 'ACTIVE' },
        select: { classId: true },
      }),
    );

    if (!enrollment) {
      throw new NotFoundException('Student has no active enrollment');
    }

    const session = await this.prisma.withTenantRead(tenantId, (db) =>
      db.attendanceSession.findFirst({
        where: {
          tenantId,
          classId: enrollment.classId,
          attendanceDate: date,
        },
        select: { id: true },
      }),
    );

    let sessionId: string;
    if (!session) {
      try {
        const created = await this.attendanceService.createSession(tenantId, {
          classId: enrollment.classId,
          date: date.toISOString().slice(0, 10),
        });
        sessionId = created.id;
      } catch (error) {
        if ((error as { code?: unknown }).code === 'P2002') {
          const existing = await this.prisma.withTenantRead(tenantId, (db) =>
            db.attendanceSession.findFirst({
              where: {
                tenantId,
                classId: enrollment.classId,
                attendanceDate: date,
              },
              select: { id: true },
            }),
          );
          if (existing) {
            sessionId = existing.id;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    } else {
      sessionId = session.id;
    }

    const mappedStatus = this.mapStatusForEntity('student', status);
    await this.prisma.withTenant(tenantId, (db) =>
      db.attendanceRecord.upsert({
        where: {
          attendanceSessionId_studentId: {
            attendanceSessionId: sessionId,
            studentId,
          },
        },
        create: {
          tenantId,
          attendanceSessionId: sessionId,
          studentId,
          status: mappedStatus as any,
          remarks: remarks?.trim(),
        },
        update: {
          status: mappedStatus as any,
          remarks: remarks?.trim() ?? null,
        },
      }),
    );
  }

  async mintSocketTicket(
    tenantId: string,
    userId: string,
  ): Promise<{ ticket: string; expiresIn: number }> {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const membership = await db.tenantMembership.findFirst({
        where: {
          tenantId,
          userId,
          status: 'ACTIVE',
          roles: { some: { role: { slug: 'RECEPTIONIST' } } },
        },
        select: { id: true },
      });
      if (!membership) {
        throw new NotFoundException('No receptionist membership found');
      }
      const ticket = await this.jwt.signAsync(
        { sub: userId, tenantId },
        { expiresIn: '600s', audience: 'socket' },
      );
      return { ticket, expiresIn: 600 };
    });
  }
}
