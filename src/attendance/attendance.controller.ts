import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import {
  AttendanceMatrixQueryDto,
  CreateAttendanceSessionDto,
  BulkMarkAttendanceDto,
} from './dto/attendance.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('ADMIN', 'ACADEMIC_ADMIN', 'TEACHER')
@ApiSecurity('X-Tenant-Id')
@Controller('attendance')
export class AttendanceController {
  constructor(private service: AttendanceService) {}

  @Post('sessions')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'TEACHER')
  createSession(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentTenant() tenant: { roles?: string[] },
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateAttendanceSessionDto,
  ) {
    return this.service.createSession(tenantId, dto, { userId, roles: tenant?.roles });
  }

  @Get('sessions/today')
  getToday(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.getToday(tenantId);
  }

  @Get('sessions/:id')
  findSession(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findSession(tenantId, id);
  }

  @Get('classes/:classId')
  findByClassAndDate(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('classId') classId: string,
    @Query('date') date: string,
  ) {
    return this.service.findByClassAndDate(tenantId, classId, date);
  }

  /** Read-only member/day matrix over a date range (admin workspace views). */
  @Get('matrix')
  listMatrix(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: AttendanceMatrixQueryDto,
  ) {
    return this.service.listMatrix(tenantId, query);
  }

  @Post('sessions/:id/mark')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'TEACHER')
  markBulk(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentTenant() tenant: { roles?: string[] },
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: BulkMarkAttendanceDto,
  ) {
    return this.service.markBulk(tenantId, id, dto, { userId, roles: tenant?.roles });
  }

  @Get('students/:studentId')
  getStudentAttendance(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('studentId') studentId: string,
    @Query('yearId') yearId: string,
  ) {
    return this.service.getStudentAttendance(tenantId, studentId, yearId);
  }
}
