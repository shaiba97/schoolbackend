import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGradingScaleDto, UpdateGradingScaleDto } from './dto/grading.dto';

@Injectable()
export class GradingService {
  constructor(private prisma: PrismaService) {}

  private assertBandsValid(bands: Array<{ minPercent: number; maxPercent: number }>) {
    for (const band of bands) {
      if (band.minPercent > band.maxPercent) {
        throw new BadRequestException(
          `Invalid band: minPercent (${band.minPercent}) exceeds maxPercent (${band.maxPercent})`,
        );
      }
    }
  }

  async createScale(tenantId: string, dto: CreateGradingScaleDto) {
    this.assertBandsValid(dto.bands);
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.isDefault) {
        await tx.gradingScale.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const scale = await tx.gradingScale.create({
        data: {
          tenantId,
          name: dto.name,
          isDefault: dto.isDefault ?? false,
        },
      });

      for (const band of dto.bands) {
        await tx.gradingBand.create({
          data: {
            tenantId,
            gradingScaleId: scale.id,
            minPercent: band.minPercent,
            maxPercent: band.maxPercent,
            grade: band.grade,
            points: band.points,
            remark: band.remark,
          },
        });
      }

      return tx.gradingScale.findFirst({
        where: { id: scale.id, tenantId },
        include: { bands: { orderBy: { minPercent: 'asc' } } },
      });
    });
  }

  async findAllScales(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.gradingScale.findMany({
        where: { tenantId },
        include: { bands: { orderBy: { minPercent: 'asc' } } },
        orderBy: { name: 'asc' },
      }),
    );
  }

  async findOneScale(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const scale = await tx.gradingScale.findFirst({
        where: { id, tenantId },
        include: { bands: { orderBy: { minPercent: 'asc' } } },
      });
      if (!scale) throw new NotFoundException('Grading scale not found');
      return scale;
    });
  }

  async updateScale(tenantId: string, id: string, dto: UpdateGradingScaleDto) {
    if (dto.bands) this.assertBandsValid(dto.bands);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.gradingScale.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Grading scale not found');

      if (dto.isDefault) {
        await tx.gradingScale.updateMany({
          where: { tenantId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      if (dto.bands) {
        await tx.gradingBand.deleteMany({ where: { gradingScaleId: id, tenantId } });
        for (const band of dto.bands) {
          await tx.gradingBand.create({
            data: {
              tenantId,
              gradingScaleId: id,
              minPercent: band.minPercent,
              maxPercent: band.maxPercent,
              grade: band.grade,
              points: band.points,
              remark: band.remark,
            },
          });
        }
      }

      return tx.gradingScale.update({
        where: { id },
        data: { name: dto.name?.trim() || undefined, isDefault: dto.isDefault },
        include: { bands: { orderBy: { minPercent: 'asc' } } },
      });
    });
  }

  async deleteScale(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.gradingScale.findFirst({
        where: { id, tenantId },
        select: { id: true, _count: { select: { examSubjects: true } } },
      });
      if (!existing) throw new NotFoundException('Grading scale not found');
      if (existing._count.examSubjects > 0) {
        throw new ConflictException(
          `Cannot delete a grading scale used by ${existing._count.examSubjects} exam subject(s); reassign them first`,
        );
      }

      await tx.gradingBand.deleteMany({ where: { gradingScaleId: id } });
      await tx.gradingScale.delete({ where: { id } });
      return { deleted: true };
    });
  }
}
