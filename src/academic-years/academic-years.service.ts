import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { CreateAcademicTermDto } from './dto/create-academic-term.dto';
import { UpdateAcademicTermDto } from './dto/update-academic-term.dto';
import { PaginatedResult } from '../common/pagination/pagination.dto';

@Injectable()
export class AcademicYearsService {
  constructor(private prisma: PrismaService) {}

  async createYear(tenantId: string, dto: CreateAcademicYearDto) {
    const startsOn = new Date(dto.startsOn);
    const endsOn = new Date(dto.endsOn);
    if (endsOn <= startsOn) {
      throw new BadRequestException('endsOn must be after startsOn');
    }

    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.isCurrent) {
        await tx.academicYear.updateMany({
          where: { tenantId, isCurrent: true },
          data: { isCurrent: false },
        });
      }

      return tx.academicYear.create({
        data: {
          tenantId,
          name: dto.name,
          startsOn,
          endsOn,
          isCurrent: dto.isCurrent ?? false,
        },
      });
    });
  }

  async findAllYears(tenantId: string, page = 1, limit = 50): Promise<PaginatedResult<any>> {
    const skip = (page - 1) * limit;
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [data, total] = await Promise.all([
        tx.academicYear.findMany({
          where: { tenantId },
          orderBy: [{ isCurrent: 'desc' }, { startsOn: 'desc' }],
          include: { _count: { select: { terms: true } } },
          skip,
          take: limit,
        }),
        tx.academicYear.count({ where: { tenantId } }),
      ]);
      return { data, total, page, limit };
    });
  }

  async findOneYear(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const year = await tx.academicYear.findFirst({
        where: { id, tenantId },
        include: {
          terms: { orderBy: { sequenceNo: 'asc' } },
        },
      });
      if (!year) {
        throw new NotFoundException('Academic year not found');
      }
      return year;
    });
  }

  async updateYear(tenantId: string, id: string, dto: UpdateAcademicYearDto) {
    const startsOn = new Date(dto.startsOn);
    const endsOn = new Date(dto.endsOn);
    if (endsOn <= startsOn) {
      throw new BadRequestException('endsOn must be after startsOn');
    }

    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.academicYear.findFirst({
        where: { id, tenantId },
      });
      if (!existing) {
        throw new NotFoundException('Academic year not found');
      }

      if (dto.isCurrent) {
        await tx.academicYear.updateMany({
          where: { tenantId, isCurrent: true, id: { not: id } },
          data: { isCurrent: false },
        });
      }

      return tx.academicYear.update({
        where: { id },
        data: {
          name: dto.name,
          startsOn,
          endsOn,
          isCurrent: dto.isCurrent ?? false,
        },
      });
    });
  }

  async deleteYear(tenantId: string, id: string, confirm?: string) {
    if (confirm !== 'true') {
      throw new BadRequestException(
        'Destructive action requires confirm=true query parameter',
      );
    }

    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.academicYear.findFirst({
        where: { id, tenantId },
      });
      if (!existing) {
        throw new NotFoundException('Academic year not found');
      }

      await tx.academicYear.delete({ where: { id } });
      return { deleted: true };
    });
  }

  async createTerm(
    tenantId: string,
    yearId: string,
    dto: CreateAcademicTermDto,
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const year = await tx.academicYear.findFirst({
        where: { id: yearId, tenantId },
      });
      if (!year) {
        throw new NotFoundException('Academic year not found');
      }

      const startsOn = new Date(dto.startsOn);
      const endsOn = new Date(dto.endsOn);
      if (endsOn <= startsOn) {
        throw new BadRequestException('endsOn must be after startsOn');
      }
      if (startsOn < year.startsOn || endsOn > year.endsOn) {
        throw new BadRequestException(
          'Term dates must fall within the academic year',
        );
      }

      return tx.academicTerm.create({
        data: {
          tenantId,
          academicYearId: yearId,
          name: dto.name,
          startsOn,
          endsOn,
          sequenceNo: dto.sequenceNo,
        },
      });
    });
  }

  async findAllTerms(tenantId: string, yearId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const year = await tx.academicYear.findFirst({
        where: { id: yearId, tenantId },
      });
      if (!year) {
        throw new NotFoundException('Academic year not found');
      }

      return tx.academicTerm.findMany({
        where: { academicYearId: yearId, tenantId },
        orderBy: { sequenceNo: 'asc' },
      });
    });
  }

  async updateTerm(
    tenantId: string,
    yearId: string,
    termId: string,
    dto: UpdateAcademicTermDto,
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const year = await tx.academicYear.findFirst({
        where: { id: yearId, tenantId },
      });
      if (!year) {
        throw new NotFoundException('Academic year not found');
      }

      const term = await tx.academicTerm.findFirst({
        where: { id: termId, academicYearId: yearId, tenantId },
      });
      if (!term) {
        throw new NotFoundException('Academic term not found');
      }

      const startsOn = new Date(dto.startsOn);
      const endsOn = new Date(dto.endsOn);
      if (endsOn <= startsOn) {
        throw new BadRequestException('endsOn must be after startsOn');
      }
      if (startsOn < year.startsOn || endsOn > year.endsOn) {
        throw new BadRequestException(
          'Term dates must fall within the academic year',
        );
      }

      return tx.academicTerm.update({
        where: { id: termId },
        data: {
          name: dto.name,
          startsOn,
          endsOn,
          sequenceNo: dto.sequenceNo,
        },
      });
    });
  }

  async deleteTerm(tenantId: string, yearId: string, termId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const year = await tx.academicYear.findFirst({
        where: { id: yearId, tenantId },
      });
      if (!year) {
        throw new NotFoundException('Academic year not found');
      }

      const term = await tx.academicTerm.findFirst({
        where: { id: termId, academicYearId: yearId, tenantId },
      });
      if (!term) {
        throw new NotFoundException('Academic term not found');
      }

      await tx.academicTerm.delete({ where: { id: termId } });
      return { deleted: true };
    });
  }
}
