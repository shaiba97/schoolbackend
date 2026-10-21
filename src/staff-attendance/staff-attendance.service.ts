import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CUSTOM_ROLE_PREFIX,
  OPERATIONAL_POSITION_SLUGS,
  SYSTEM_POSITION_SLUGS,
} from '../staff/staff.service';
import { UpsertStaffAttendanceDto, UpsertStaffMemberAttendanceDto } from './dto/staff-attendance.dto';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Staff (teacher) attendance, recorded by admin/financial staff — teachers
 * themselves never write here; they read their own history. One row per
 * teacher per day (upsert); a mid-day departure is recorded as PRESENT with
 * a `leftAt` time rather than a separate status, so monthly counts stay
 * simple (present / absent / leave).
 */
@Injectable()
export class StaffAttendanceService {
  constructor(private prisma: PrismaService) {}

  private async resolveTeacherId(db: Db, tenantId: string, userId: string): Promise<string> {
    const teacher = await db.teacher.findFirst({
      where: { tenantId, userId },
      select: { id: true, status: true },
    });
    if (!teacher) {
      throw new ForbiddenException('No teacher profile exists for this account in this school');
    }
    return teacher.id;
  }

  private monthRange(month?: string): { gte?: Date; lt?: Date } {
    if (!month) return {};
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException('month must be YYYY-MM');
    }
    const [year, mon] = month.split('-').map(Number);
    return {
      gte: new Date(Date.UTC(year, mon - 1, 1)),
      lt: new Date(Date.UTC(year, mon, 1)),
    };
  }

  async upsertEntries(tenantId: string, markedById: string, dto: UpsertStaffAttendanceDto) {
    const date = new Date(dto.date);
    return this.prisma.withTenant(tenantId, async (db) => {
      const results: unknown[] = [];
      for (const entry of dto.entries) {
        const teacher = await db.teacher.findFirst({
          where: { id: entry.teacherId, tenantId },
          select: { id: true },
        });
        if (!teacher) {
          throw new NotFoundException(`Teacher not found: ${entry.teacherId}`);
        }
        if (entry.leftAt && entry.status !== 'PRESENT') {
          throw new BadRequestException('leftAt is only valid with PRESENT status');
        }
        results.push(
          await db.staffAttendance.upsert({
            where: {
              tenantId_teacherId_attendanceDate: {
                tenantId,
                teacherId: entry.teacherId,
                attendanceDate: date,
              },
            },
            create: {
              tenantId,
              teacherId: entry.teacherId,
              attendanceDate: date,
              status: entry.status as never,
              leftAt: entry.leftAt,
              remarks: entry.remarks?.trim() || undefined,
              markedById,
            },
            update: {
              status: entry.status as never,
              leftAt: entry.leftAt ?? null,
              remarks: entry.remarks?.trim() || null,
              markedById,
            },
          }),
        );
      }
      return results;
    });
  }

  async listForTeacher(tenantId: string, userId: string, month?: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const teacherId = await this.resolveTeacherId(db, tenantId, userId);
      const range = this.monthRange(month);
      const entries = await db.staffAttendance.findMany({
        where: { tenantId, teacherId, ...(range.gte ? { attendanceDate: range } : {}) },
        orderBy: { attendanceDate: 'desc' },
        select: {
          id: true,
          attendanceDate: true,
          status: true,
          leftAt: true,
          remarks: true,
        },
      });
      return {
        entries: entries.map((row) => ({
          ...row,
          attendanceDate:
            row.attendanceDate instanceof Date
              ? row.attendanceDate.toISOString().slice(0, 10)
              : row.attendanceDate,
        })),
        summary: {
          present: entries.filter((row) => row.status === 'PRESENT').length,
          absent: entries.filter((row) => row.status === 'ABSENT').length,
          leave: entries.filter((row) => row.status === 'LEAVE').length,
        },
      };
    });
  }

  async listForAdmin(tenantId: string, query: { teacherId?: string; month?: string }) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      if (query.teacherId) {
        const teacher = await db.teacher.findFirst({
          where: { id: query.teacherId, tenantId },
          select: { id: true },
        });
        if (!teacher) throw new NotFoundException(`Teacher not found: ${query.teacherId}`);
      }
      const range = this.monthRange(query.month);
      return db.staffAttendance.findMany({
        where: {
          tenantId,
          ...(query.teacherId ? { teacherId: query.teacherId } : {}),
          ...(range.gte ? { attendanceDate: range } : {}),
        },
        orderBy: [{ attendanceDate: 'desc' }, { teacherId: 'asc' }],
        include: {
          teacher: {
            select: {
              id: true,
              employeeNumber: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      });
    });
  }

  /** Validates that a user is a member of the tenant's non-teaching staff directory. */
  private async assertStaffMember(db: Db, tenantId: string, userId: string): Promise<void> {
    const membership = await db.tenantMembership.findFirst({
      where: {
        tenantId,
        userId,
        status: 'ACTIVE',
        roles: {
          some: {
            role: {
              OR: [
                { slug: { in: [...SYSTEM_POSITION_SLUGS, ...OPERATIONAL_POSITION_SLUGS] } },
                { slug: { startsWith: CUSTOM_ROLE_PREFIX } },
              ],
            },
          },
        },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new NotFoundException(`Staff member not found in this school: ${userId}`);
    }
  }

  async upsertMemberEntries(tenantId: string, markedById: string, dto: UpsertStaffMemberAttendanceDto) {
    const date = new Date(dto.date);
    return this.prisma.withTenant(tenantId, async (db) => {
      const results: unknown[] = [];
      for (const entry of dto.entries) {
        await this.assertStaffMember(db, tenantId, entry.userId);
        if (entry.leftAt && entry.status !== 'PRESENT') {
          throw new BadRequestException('leftAt is only valid with PRESENT status');
        }
        results.push(
          await db.staffMemberAttendance.upsert({
            where: {
              tenantId_userId_attendanceDate: {
                tenantId,
                userId: entry.userId,
                attendanceDate: date,
              },
            },
            create: {
              tenantId,
              userId: entry.userId,
              attendanceDate: date,
              status: entry.status as never,
              leftAt: entry.leftAt,
              remarks: entry.remarks?.trim() || undefined,
              markedById,
            },
            update: {
              status: entry.status as never,
              leftAt: entry.leftAt ?? null,
              remarks: entry.remarks?.trim() || null,
              markedById,
            },
          }),
        );
      }
      return results;
    });
  }

  async listMembers(tenantId: string, query: { userId?: string; month?: string }) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      if (query.userId) {
        await this.assertStaffMember(db, tenantId, query.userId);
      }
      const range = this.monthRange(query.month);
      return db.staffMemberAttendance.findMany({
        where: {
          tenantId,
          ...(query.userId ? { userId: query.userId } : {}),
          ...(range.gte ? { attendanceDate: range } : {}),
        },
        orderBy: [{ attendanceDate: 'desc' }, { userId: 'asc' }],
        include: {
          user: { select: { id: true, firstName: true, lastName: true, staffNumber: true } },
        },
      });
    });
  }
}
