import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceQueryDto, StaffMemberAttendanceQueryDto, UpsertStaffAttendanceDto, UpsertStaffMemberAttendanceDto } from './dto/staff-attendance.dto';

@ApiTags('Staff Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@ApiHeader({
  name: 'X-Tenant-Id',
  required: true,
  description: 'Tenant UUID for the current school',
})
@Controller('staff-attendance')
export class StaffAttendanceController {
  constructor(private service: StaffAttendanceService) {}

  @Post('entries')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  upsertEntries(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpsertStaffAttendanceDto,
  ) {
    return this.service.upsertEntries(tenantId, userId, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  list(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: StaffAttendanceQueryDto,
  ) {
    return this.service.listForAdmin(tenantId, query);
  }

  @Get('members')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  listMembers(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: StaffMemberAttendanceQueryDto,
  ) {
    return this.service.listMembers(tenantId, query);
  }

  @Post('members/entries')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  upsertMemberEntries(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: UpsertStaffMemberAttendanceDto,
  ) {
    return this.service.upsertMemberEntries(tenantId, userId, dto);
  }
}
