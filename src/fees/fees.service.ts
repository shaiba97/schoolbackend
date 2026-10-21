import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateFeeTypeDto, UpdateFeeTypeDto,
  CreateFeeStructureDto, UpdateFeeStructureDto,
} from './dto/fee.dto';
import { PaginatedResult } from '../common/pagination/pagination.dto';

@Injectable()
export class FeesService {
  constructor(private prisma: PrismaService) {}

  // --- Fee Types ---
  async createFeeType(tenantId: string, dto: CreateFeeTypeDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.feeType.create({ data: { tenantId, ...dto } }),
    );
  }

  async findAllFeeTypes(tenantId: string, page = 1, limit = 50): Promise<PaginatedResult<any>> {
    const skip = (page - 1) * limit;
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const where = { tenantId };
      const [data, total] = await Promise.all([
        tx.feeType.findMany({ where, orderBy: { name: 'asc' }, skip, take: limit }),
        tx.feeType.count({ where }),
      ]);
      return { data, total, page, limit };
    });
  }

  async updateFeeType(tenantId: string, id: string, dto: UpdateFeeTypeDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.feeType.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Fee type not found');
      return tx.feeType.update({ where: { id }, data: dto });
    });
  }

  async deleteFeeType(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.feeType.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Fee type not found');
      await tx.feeType.delete({ where: { id } });
      return { deleted: true };
    });
  }

  // --- Fee Structures ---
  async createFeeStructure(tenantId: string, dto: CreateFeeStructureDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const currencyCode = tenant?.currencyCode ?? 'SDG';

      const created = await tx.feeStructure.create({
        data: {
          tenantId,
          academicYearId: dto.academicYearId,
          classId: dto.schoolClassId,
          name: dto.name,
          categoryId: dto.categoryId ?? null,
          tuitionFee: dto.amount,
          registrationFee: dto.registrationFee ?? 0,
          currencyCode,
          frequency: 'ANNUAL',
          installmentCount: 1,
          installments: {
            create: [{ installmentNo: 1, amount: dto.amount, dueDate: new Date() }],
          },
        },
        include: { installments: { orderBy: { installmentNo: 'asc' } } },
      });
      return created;
    });
  }

  async findAllFeeStructures(tenantId: string, yearId?: string, page = 1, limit = 50): Promise<PaginatedResult<any>> {
    const skip = (page - 1) * limit;
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const where = { tenantId, academicYearId: yearId };
      const [data, total] = await Promise.all([
        tx.feeStructure.findMany({
          where,
          include: { schoolClass: true, installments: { orderBy: { installmentNo: 'asc' } } },
          skip,
          take: limit,
        }),
        tx.feeStructure.count({ where }),
      ]);
      return { data, total, page, limit };
    });
  }
}
