import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHallDto, UpdateHallDto } from './dto/hall.dto';

@Injectable()
export class HallsService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.hall.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async findOne(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const hall = await tx.hall.findFirst({ where: { id, tenantId } });
      if (!hall) throw new NotFoundException('Hall not found');
      return hall;
    });
  }

  async create(tenantId: string, dto: CreateHallDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.hall.findFirst({
        where: { tenantId, name: dto.name.trim() },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('A hall with this name already exists');
      }
      try {
        return await tx.hall.create({
          data: {
            tenantId,
            name: dto.name.trim(),
            capacity: dto.capacity,
            type: dto.type as any,
          },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('A hall with this name already exists');
        }
        throw error;
      }
    });
  }

  async update(tenantId: string, id: string, dto: UpdateHallDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.hall.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Hall not found');

      if (dto.name !== undefined) {
        const dup = await tx.hall.findFirst({
          where: { tenantId, name: dto.name.trim(), id: { not: id } },
          select: { id: true },
        });
        if (dup) {
          throw new ConflictException('A hall with this name already exists');
        }
      }

      try {
        return await tx.hall.update({
          where: { id_tenantId: { id, tenantId } },
          data: {
            name: dto.name?.trim(),
            capacity: dto.capacity,
            type: dto.type as any,
          },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('A hall with this name already exists');
        }
        throw error;
      }
    });
  }

  async remove(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.hall.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          _count: { select: { timetableSlots: true, seatAssignments: true, invigilationDuties: true } },
        },
      });
      if (!existing) throw new NotFoundException('Hall not found');
      const used =
        existing._count.timetableSlots +
        existing._count.seatAssignments +
        existing._count.invigilationDuties;
      if (used > 0) {
        throw new ConflictException('Cannot delete a hall referenced by scheduled sessions');
      }
      await tx.hall.delete({ where: { id_tenantId: { id, tenantId } } });
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
