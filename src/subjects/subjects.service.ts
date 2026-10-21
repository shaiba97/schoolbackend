import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BatchCreateSubjectsDto,
  CreateSubjectDto,
  UpdateSubjectDto,
} from './dto/subject.dto';
import { CreateClassSubjectDto, UpdateClassSubjectDto } from './dto/class-subject.dto';
import { PaginatedResult } from '../common/pagination/pagination.dto';
import { safeUserSelect } from '../common/safe-user.select';

@Injectable()
export class SubjectsService {
  constructor(private prisma: PrismaService) {}

  private async assertDepartmentsExist(tx: any, tenantId: string, departmentIds: string[]): Promise<void> {
    const unique = [...new Set(departmentIds)];
    const found = await tx.department.findMany({
      where: { tenantId, id: { in: unique } },
      select: { id: true },
    });
    const known = new Set(found.map((department: { id: string }) => department.id));
    const missing = unique.filter((id) => !known.has(id));
    if (missing.length) throw new NotFoundException('Department not found');
  }

  async createSubject(tenantId: string, dto: CreateSubjectDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertDepartmentsExist(tx, tenantId, [dto.departmentId]);
      const existing = await tx.subject.findFirst({
        where: { tenantId, name: dto.name },
      });
      if (existing) {
        throw new ConflictException('Subject name already exists');
      }

      return tx.subject.create({
        data: { tenantId, ...dto },
        include: { department: true },
      });
    });
  }

  /**
   * Creates many global subjects at once, all in a single transaction — so a
   * partially applied batch is never visible. Attaching them to classes is a
   * separate, explicit step (see assignSubjectsToClasses).
   */
  async batchCreateSubjects(tenantId: string, dto: BatchCreateSubjectsDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertDepartmentsExist(tx, tenantId, dto.items.map((item) => item.departmentId));

      const names = dto.items.map((item) => item.name.trim());
      const lowered = names.map((name) => name.toLowerCase());
      if (new Set(lowered).size !== lowered.length) {
        throw new ConflictException('The same subject name appears more than once in this request');
      }

      const existing = await tx.subject.findMany({
        where: { tenantId, name: { in: names } },
        select: { name: true },
      });
      if (existing.length > 0) {
        throw new ConflictException(`Subject already exists: ${existing[0].name}`);
      }

      // One roundtrip for the whole batch: per-row creates inside an
      // interactive transaction exceed its default timeout once the batch
      // grows (observed at 8+ rows over remote connections).
      await tx.subject.createMany({
        data: names.map((name, index) => ({
          tenantId,
          name,
          departmentId: dto.items[index].departmentId,
        })),
      });

      const rows = await tx.subject.findMany({
        where: { tenantId, name: { in: names } },
        include: { department: true },
      });
      const byName = new Map(rows.map((row) => [row.name, row]));
      return { created: names.map((name) => byName.get(name)) };
    });
  }

  /**
   * Attaches subjects to classes, one row per (class, subject). No sections
   * exist anymore, so there is nothing to provision — missing classes 404.
   */
  private async assignToClasses(
    tx: any,
    tenantId: string,
    subjectIds: string[],
    classIds: string[],
  ): Promise<{ assigned: number; skippedClasses: string[] }> {
    if (subjectIds.length === 0 || classIds.length === 0) {
      return { assigned: 0, skippedClasses: [] };
    }

    const classes = await tx.schoolClass.findMany({
      where: { tenantId, id: { in: classIds } },
      select: { id: true, className: true },
    });
    const known = new Set(classes.map((schoolClass: { id: string }) => schoolClass.id));
    const missingClasses = classIds.filter((id) => !known.has(id));
    if (missingClasses.length) throw new NotFoundException('Class not found');

    const existing = await tx.classSubject.findMany({
      where: { tenantId, classId: { in: classIds }, subjectId: { in: subjectIds } },
      select: { classId: true, subjectId: true },
    });
    const present = new Set(existing.map((row: { classId: string; subjectId: string }) => `${row.classId}:${row.subjectId}`));

    let assigned = 0;
    for (const classId of classIds) {
      for (const subjectId of subjectIds) {
        if (present.has(`${classId}:${subjectId}`)) continue;
        await tx.classSubject.create({ data: { tenantId, classId, subjectId } });
        assigned += 1;
      }
    }

    return { assigned, skippedClasses: [] };
  }

  async assignSubjectsToClasses(tenantId: string, subjectId: string, classIds: string[]) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const subject = await tx.subject.findFirst({ where: { id: subjectId, tenantId } });
      if (!subject) throw new NotFoundException('Subject not found');
      return this.assignToClasses(tx, tenantId, [subjectId], classIds);
    });
  }

  async findAllSubjects(tenantId: string, page = 1, limit = 50): Promise<PaginatedResult<any>> {
    const skip = (page - 1) * limit;
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [data, total] = await Promise.all([
        tx.subject.findMany({
          where: { tenantId },
          orderBy: { name: 'asc' },
          include: { department: true, _count: { select: { classSubjects: true } } },
          skip,
          take: limit,
        }),
        tx.subject.count({ where: { tenantId } }),
      ]);

      // "# Classes Assigned" counts distinct classes, one row each by construction.
      const assignments = await tx.classSubject.findMany({
        where: { tenantId, subjectId: { in: data.map((subject: { id: string }) => subject.id) } },
        select: { subjectId: true, classId: true },
      });
      const classesBySubject = new Map<string, Set<string>>();
      for (const assignment of assignments) {
        const bucket = classesBySubject.get(assignment.subjectId) ?? new Set<string>();
        bucket.add(assignment.classId);
        classesBySubject.set(assignment.subjectId, bucket);
      }

      return {
        data: data.map((subject: any) => ({
          ...subject,
          counts: { classes: classesBySubject.get(subject.id)?.size ?? 0 },
        })),
        total,
        page,
        limit,
      };
    });
  }

  async findOneSubject(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const subject = await tx.subject.findFirst({
        where: { id, tenantId },
        include: {
          classSubjects: {
            include: {
              schoolClass: true,
              teacher: { include: { user: { select: safeUserSelect } } },
            },
          },
        },
      });
      if (!subject) throw new NotFoundException('Subject not found');
      return subject;
    });
  }

  async updateSubject(tenantId: string, id: string, dto: UpdateSubjectDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.subject.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Subject not found');
      if (dto.departmentId) await this.assertDepartmentsExist(tx, tenantId, [dto.departmentId]);

      return tx.subject.update({ where: { id }, data: dto, include: { department: true } });
    });
  }

  async deleteSubject(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.subject.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Subject not found');

      // Deleting would either cascade away class assignments or trip the
      // timetable's referential guard — surface a usable message instead.
      const [assignments, timetableSlots] = await Promise.all([
        tx.classSubject.count({ where: { subjectId: id, tenantId } }),
        tx.timetableEntry.count({ where: { subjectId: id, tenantId } }),
      ]);
      if (assignments > 0) {
        throw new ConflictException(
          `Subject is assigned to ${assignments} ${assignments === 1 ? 'class' : 'classes'}; remove those assignments first`,
        );
      }
      if (timetableSlots > 0) {
        throw new ConflictException('Subject is used by timetable entries; clear those slots first');
      }

      await tx.subject.delete({ where: { id } });
      return { deleted: true };
    });
  }

  async assignSubjectToClass(
    tenantId: string,
    classId: string,
    dto: CreateClassSubjectDto,
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const schoolClass = await tx.schoolClass.findFirst({
        where: { id: classId, tenantId },
      });
      if (!schoolClass) throw new NotFoundException('Class not found');

      const subject = await tx.subject.findFirst({
        where: { id: dto.subjectId, tenantId },
      });
      if (!subject) throw new NotFoundException('Subject not found');

      const existing = await tx.classSubject.findFirst({
        where: { classId, subjectId: dto.subjectId, tenantId },
      });
      if (existing) {
        throw new ConflictException('Subject already assigned to this class');
      }

      return tx.classSubject.create({
        data: {
          tenantId,
          classId,
          subjectId: dto.subjectId,
          teacherId: dto.teacherId,
        },
        include: {
          subject: true,
          teacher: { include: { user: { select: safeUserSelect } } },
        },
      });
    });
  }

  async findClassSubjects(tenantId: string, classId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.classSubject.findMany({
        where: { classId, tenantId },
        include: {
          subject: true,
          teacher: { include: { user: { select: safeUserSelect } } },
        },
      }),
    );
  }

  async updateClassSubject(
    tenantId: string,
    classSubjectId: string,
    dto: UpdateClassSubjectDto,
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.classSubject.findFirst({
        where: { id: classSubjectId, tenantId },
      });
      if (!existing) throw new NotFoundException('Class-subject assignment not found');

      return tx.classSubject.update({
        where: { id: classSubjectId },
        data: { teacherId: dto.teacherId },
        include: { subject: true, teacher: { include: { user: { select: safeUserSelect } } } },
      });
    });
  }

  async removeSubjectFromClass(tenantId: string, classSubjectId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.classSubject.findFirst({
        where: { id: classSubjectId, tenantId },
      });
      if (!existing) throw new NotFoundException('Class-subject assignment not found');

      await tx.classSubject.delete({ where: { id: classSubjectId } });
      return { deleted: true };
    });
  }
}
