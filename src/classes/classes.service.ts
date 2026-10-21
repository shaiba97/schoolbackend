import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSchoolClassDto, UpdateSchoolClassDto } from './dto/school-class.dto';
import { PaginatedResult } from '../common/pagination/pagination.dto';
import { safeUserSelect } from '../common/safe-user.select';

@Injectable()
export class ClassesService {
  constructor(private prisma: PrismaService) {}

  private validateClassShape(input: { educationLevel: string; grade: string; track?: string; gender?: string }): void {
    const secondaryGrades = new Set(['FIRST', 'SECOND', 'THIRD']);
    const intermediateGrades = new Set(['SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH']);
    if (input.educationLevel === 'SECONDARY' && !secondaryGrades.has(input.grade)) {
      throw new BadRequestException('Secondary classes must use FIRST, SECOND, or THIRD grade');
    }
    if (input.educationLevel === 'INTERMEDIATE' && !intermediateGrades.has(input.grade)) {
      throw new BadRequestException('Intermediate classes must use SIXTH, SEVENTH, EIGHTH, or NINTH grade');
    }
    const trackRequired = input.educationLevel === 'SECONDARY' && (input.grade === 'SECOND' || input.grade === 'THIRD');
    if (trackRequired && !input.track) throw new BadRequestException('Track is required for SECOND or THIRD grade');
    if (!trackRequired && input.track) throw new BadRequestException('Track is only valid for SECOND or THIRD grade');
    // Gender follows the school structure: Intermediate is boys-only,
    // Secondary splits into BOYS and GIRLS (no MIXED classes). Rows that
    // predate the gender column are grandfathered until a gender is set.
    if (input.gender == null) return;
    if (input.educationLevel === 'INTERMEDIATE' && input.gender !== 'BOYS') {
      throw new BadRequestException('Girls classes are not allowed for Intermediate level');
    }
    if (input.educationLevel === 'SECONDARY' && input.gender !== 'BOYS' && input.gender !== 'GIRLS') {
      throw new BadRequestException('Secondary classes must be BOYS or GIRLS');
    }
  }

  async createClass(tenantId: string, dto: CreateSchoolClassDto) {
    this.validateClassShape(dto);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.schoolClass.findFirst({
        where: { tenantId, className: dto.className.trim() },
      });
      if (existing) {
        throw new ConflictException('Class name already exists');
      }

      return tx.schoolClass.create({
        data: {
          tenantId,
          className: dto.className.trim(),
          educationLevel: dto.educationLevel as any,
          grade: dto.grade as any,
          track: dto.track as any,
          gender: dto.gender,
          capacity: dto.capacity,
        },
      });
    });
  }

  /**
   * Students and teachers are recomputed on every read rather than stored: a
   * cached counter goes stale the moment someone enrolls a student or reassigns
   * a subject teacher.
   */
  async findAllClasses(tenantId: string, page = 1, limit = 50): Promise<PaginatedResult<any>> {
    const skip = (page - 1) * limit;
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [data, total, enrollments, assignments] = await Promise.all([
        tx.schoolClass.findMany({
          where: { tenantId },
          orderBy: { className: 'asc' },
          include: { classTeacher: { include: { user: { select: safeUserSelect } } } },
          skip,
          take: limit,
        }),
        tx.schoolClass.count({ where: { tenantId } }),
        tx.studentEnrollment.findMany({
          where: { tenantId, status: 'ACTIVE' },
          select: { classId: true },
        }),
        tx.classSubject.findMany({
          where: { tenantId, teacherId: { not: null } },
          select: { teacherId: true, classId: true },
        }),
      ]);

      const studentsByClass = new Map<string, number>();
      for (const enrollment of enrollments) {
        studentsByClass.set(enrollment.classId, (studentsByClass.get(enrollment.classId) ?? 0) + 1);
      }
      const teachersByClass = new Map<string, Set<string>>();
      for (const assignment of assignments) {
        const classId = assignment.classId;
        const teacherId = assignment.teacherId as string;
        const bucket = teachersByClass.get(classId) ?? new Set<string>();
        bucket.add(teacherId);
        teachersByClass.set(classId, bucket);
      }

      return {
        data: data.map((schoolClass) => ({
          ...schoolClass,
          counts: {
            students: studentsByClass.get(schoolClass.id) ?? 0,
            teachers: teachersByClass.get(schoolClass.id)?.size ?? 0,
          },
        })),
        total,
        page,
        limit,
      };
    });
  }

  async findOneClass(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const cls = await tx.schoolClass.findFirst({
        where: { id, tenantId },
        include: {
          classTeacher: { include: { user: { select: safeUserSelect } } },
        },
      });
      if (!cls) throw new NotFoundException('Class not found');
      return cls;
    });
  }

  async updateClass(tenantId: string, id: string, dto: UpdateSchoolClassDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.schoolClass.findFirst({
        where: { id, tenantId },
        select: { id: true, className: true, educationLevel: true, grade: true, track: true, gender: true },
      });
      if (!existing) throw new NotFoundException('Class not found');

      const next = {
        educationLevel: dto.educationLevel ?? existing.educationLevel,
        grade: dto.grade ?? existing.grade,
        track: dto.track ?? existing.track ?? undefined,
        gender: dto.gender ?? existing.gender ?? undefined,
      };
      this.validateClassShape(next);

      if (dto.className) {
        const className = dto.className.trim();
        if (className !== existing.className) {
          const clash = await tx.schoolClass.findFirst({
            where: { tenantId, className, NOT: { id } },
            select: { id: true },
          });
          if (clash) throw new ConflictException('Class name already exists');
        }
      }

      const data: any = {
        className: dto.className?.trim(),
        educationLevel: dto.educationLevel as any,
        grade: dto.grade as any,
        track: dto.track as any,
        gender: dto.gender,
        capacity: dto.capacity,
      };
      if (dto.classTeacherId !== undefined) {
        if (dto.classTeacherId) {
          const teacher = await tx.teacher.findFirst({ where: { id: dto.classTeacherId, tenantId }, select: { id: true } });
          if (!teacher) throw new NotFoundException('Teacher not found');
          data.classTeacherId = dto.classTeacherId;
        } else {
          data.classTeacherId = null;
        }
      }

      return tx.schoolClass.update({ where: { id }, data });
    });
  }

  async deleteClass(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.schoolClass.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Class not found');

      await tx.schoolClass.delete({ where: { id } });
      return { deleted: true };
    });
  }

}
