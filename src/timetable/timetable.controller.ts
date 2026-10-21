import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { TimetableService } from './timetable.service';
import { BatchTimetableDto, TimetableQueryDto } from './dto/timetable.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';

@ApiTags('Timetable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('timetable')
export class TimetableController {
  constructor(private service: TimetableService) {}

  @Get()
  findAll(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: TimetableQueryDto,
  ) {
    return this.service.findAll(tenantId, query);
  }

  @Get('class/:classId')
  findByClass(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('classId') classId: string,
    @Query('yearId') yearId: string,
    @Query('timetableType') timetableType: string,
    @Query('examName') examName: string,
  ) {
    return this.service.findByClass(tenantId, classId, yearId, timetableType, examName);
  }

  /** Declared ahead of `:id` so it is never swallowed by the generic route. */
  @Put('batch')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  batchSave(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: BatchTimetableDto,
  ) {
    return this.service.batchSave(tenantId, dto);
  }
}
