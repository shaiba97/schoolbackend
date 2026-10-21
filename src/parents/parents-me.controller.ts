import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { WardGuard } from './ward.guard';
import { PerformanceTrendQueryDto } from '../students/dto/performance-trend.dto';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { ParentsMeService } from './parents-me.service';

/**
 * Guardian self-service surface for the guardian portal. Every route derives
 * the guardian from the authenticated user and verifies the ward link —
 * a guardianId is never accepted as a parameter.
 */
@ApiTags('Parents (me)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, WardGuard)
@ApiSecurity('X-Tenant-Id')
@Roles('PARENT')
@Controller('parents/me')
export class ParentsMeController {
  constructor(private service: ParentsMeService) {}

  @Get('profile')
  getProfile(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.getProfile(tenantId, userId);
  }

  @Get('children')
  listChildren(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.listChildren(tenantId, userId);
  }

  @Get('children/:childId/results')
  wardResults(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('childId', new ParseUUIDPipe({ version: '4' })) childId: string,
  ) {
    return this.service.getWardResults(tenantId, userId, childId);
  }

  @Get('children/:childId/attendance')
  wardAttendance(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('childId', new ParseUUIDPipe({ version: '4' })) childId: string,
  ) {
    return this.service.getWardAttendance(tenantId, userId, childId);
  }

  @Get('children/:childId/timetable')
  wardTimetable(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('childId', new ParseUUIDPipe({ version: '4' })) childId: string,
  ) {
    return this.service.getWardTimetable(tenantId, userId, childId);
  }

  @Get('children/:childId/cases')
  wardCases(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('childId', new ParseUUIDPipe({ version: '4' })) childId: string,
  ) {
    return this.service.getWardCases(tenantId, userId, childId);
  }

  @Get('children/:childId/performance-trend')
  wardTrend(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('childId', new ParseUUIDPipe({ version: '4' })) childId: string,
    @Query() query: PerformanceTrendQueryDto,
  ) {
    return this.service.getWardTrend(tenantId, userId, childId, query);
  }

  @Get('socket-ticket')
  socketTicket(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.mintSocketTicket(tenantId, userId);
  }
}
