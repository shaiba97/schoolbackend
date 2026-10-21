import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  private readonly select = {
    id: true,
    name: true,
    _count: { select: { teachers: true } },
  } as const;

  async list(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.department.findMany({
        where: { tenantId },
        select: this.select,
        orderBy: { name: 'asc' },
      }),
    );
  }

  async findOne(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const department = await tx.department.findFirst({
        where: { id, tenantId },
        select: this.select,
      });
      if (!department) throw new NotFoundException('Department not found');
      return department;
    });
  }

  async create(tenantId: string, dto: CreateDepartmentDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.department.findFirst({
        where: { tenantId, name: dto.name.trim() },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('A department with this name already exists');
      }
      try {
        const department = await tx.department.create({
          data: {
            tenantId,
            name: dto.name.trim(),
          },
          select: this.select,
        });
        return department;
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('A department with this name already exists');
        }
        throw error;
      }
    });
  }

  async update(tenantId: string, id: string, dto: UpdateDepartmentDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.department.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Department not found');

      if (dto.name !== undefined) {
        const dup = await tx.department.findFirst({
          where: { tenantId, name: dto.name.trim(), id: { not: id } },
          select: { id: true },
        });
        if (dup) {
          throw new ConflictException('A department with this name already exists');
        }
      }

      try {
        const department = await tx.department.update({
          where: { id },
          data: {
            name: dto.name?.trim(),
          },
          select: this.select,
        });
        return department;
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('A department with this name already exists');
        }
        throw error;
      }
    });
  }

  async remove(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.department.findFirst({
        where: { id, tenantId },
        select: { id: true, _count: { select: { teachers: true } } },
      });
      if (!existing) throw new NotFoundException('Department not found');
      if (existing._count.teachers > 0) {
        throw new ConflictException(
          `Cannot delete department with ${existing._count.teachers} assigned teacher(s); reassign teachers first`,
        );
      }
      await tx.department.delete({ where: { id } });
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
