import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExamTypeDto, UpdateExamTypeDto } from './dto/exam-type.dto';

@Injectable()
export class ExamTypesService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.examType.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async findOne(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const type = await tx.examType.findFirst({ where: { id, tenantId } });
      if (!type) throw new NotFoundException('Exam type not found');
      return type;
    });
  }

  async create(tenantId: string, dto: CreateExamTypeDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.examType.findFirst({
        where: { tenantId, name: dto.name.trim() },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('An exam type with this name already exists');
      }
      try {
        return await tx.examType.create({
          data: {
            tenantId,
            name: dto.name.trim(),
            defaultWeight: dto.defaultWeight,
          },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('An exam type with this name already exists');
        }
        throw error;
      }
    });
  }

  async update(tenantId: string, id: string, dto: UpdateExamTypeDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.examType.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Exam type not found');

      if (dto.name !== undefined) {
        const dup = await tx.examType.findFirst({
          where: { tenantId, name: dto.name.trim(), id: { not: id } },
          select: { id: true },
        });
        if (dup) {
          throw new ConflictException('An exam type with this name already exists');
        }
      }

      try {
        return await tx.examType.update({
          where: { id_tenantId: { id, tenantId } },
          data: {
            name: dto.name?.trim(),
            defaultWeight: dto.defaultWeight,
          },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('An exam type with this name already exists');
        }
        throw error;
      }
    });
  }

  async remove(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.examType.findFirst({
        where: { id, tenantId },
        select: { id: true, _count: { select: { exams: true } } },
      });
      if (!existing) throw new NotFoundException('Exam type not found');
      if (existing._count.exams > 0) {
        throw new ConflictException(
          `Cannot delete exam type used by ${existing._count.exams} exam(s)`,
        );
      }
      await tx.examType.delete({ where: { id_tenantId: { id, tenantId } } });
      return { id };
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}
