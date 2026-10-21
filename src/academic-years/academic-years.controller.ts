import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AcademicYearsService } from './academic-years.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { CreateAcademicTermDto } from './dto/create-academic-term.dto';
import { UpdateAcademicTermDto } from './dto/update-academic-term.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination.dto';

@ApiTags('Academic Years')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('academic-years')
export class AcademicYearsController {
  constructor(private service: AcademicYearsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  createYear(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateAcademicYearDto,
  ) {
    return this.service.createYear(tenantId, dto);
  }

  @Get()
  findAllYears(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.service.findAllYears(tenantId, query.page, query.limit);
  }

  @Get(':id')
  findOneYear(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOneYear(tenantId, id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  updateYear(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAcademicYearDto,
  ) {
    return this.service.updateYear(tenantId, id, dto);
  }

  @Delete(':id')
  @ApiQuery({ name: 'confirm', required: false })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  deleteYear(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Query('confirm') confirm?: string,
  ) {
    return this.service.deleteYear(tenantId, id, confirm);
  }

  @Post(':yearId/terms')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  createTerm(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('yearId') yearId: string,
    @Body() dto: CreateAcademicTermDto,
  ) {
    return this.service.createTerm(tenantId, yearId, dto);
  }

  @Get(':yearId/terms')
  findAllTerms(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('yearId') yearId: string,
  ) {
    return this.service.findAllTerms(tenantId, yearId);
  }

  @Put(':yearId/terms/:termId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  updateTerm(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('yearId') yearId: string,
    @Param('termId') termId: string,
    @Body() dto: UpdateAcademicTermDto,
  ) {
    return this.service.updateTerm(tenantId, yearId, termId, dto);
  }

  @Delete(':yearId/terms/:termId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  deleteTerm(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('yearId') yearId: string,
    @Param('termId') termId: string,
  ) {
    return this.service.deleteTerm(tenantId, yearId, termId);
  }
}
