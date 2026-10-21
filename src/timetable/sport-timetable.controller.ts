import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { TimetableService } from './timetable.service';
import { SportQueryDto } from './dto/sport-timetable.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';

@ApiTags('Sport Timetable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('sport-timetable')
export class SportTimetableController {
  constructor(private service: TimetableService) {}

  @Get()
  findAll(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: SportQueryDto,
  ) {
    return this.service.findSport(tenantId, query);
  }
}
