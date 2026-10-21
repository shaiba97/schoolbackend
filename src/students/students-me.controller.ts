import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { StudentsMeService } from './students-me.service';
import { PerformanceTrendQueryDto } from './dto/performance-trend.dto';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';

/**
 * Self-scoped student surface.
 *
 * Invariants this controller must keep:
 *  - No handler accepts a student id. The caller is always resolved from the
 *    session, so a student cannot reach another student's records by editing
 *    a path parameter or query string.
 *  - Identity alone authorises these reads — there is deliberately no
 *    `@Roles('STUDENT')`, because a teacher or admin opening their own portal
 *    is not the threat model, and the role gate would break the shared shell.
 *    The `StudentsController` (admin surface) carries the role checks.
 */
@ApiTags('Students (me)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiHeader({
  name: 'X-Tenant-Id',
  required: true,
  description: 'Tenant UUID for the current school',
})
@ApiSecurity('X-Tenant-Id')
@Controller('students/me')
export class StudentsMeController {
  constructor(private service: StudentsMeService) {}

  @Get('profile')
  profile(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.getProfile(tenantId, userId);
  }

  @Get('timetable')
  timetable(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.getTimetable(tenantId, userId);
  }

  @Get('results')
  results(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.getResults(tenantId, userId);
  }

  @Get('results/:examId/pdf')
  async resultPdf(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('examId', new ParseUUIDPipe({ version: '4' })) examId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, buffer } = await this.service.getResultPdf(tenantId, userId, examId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }

  @Get('attendance')
  attendance(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.getAttendance(tenantId, userId);
  }

  @Get('cases')
  cases(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.getCases(tenantId, userId);
  }

  @Get('performance-trend')
  performanceTrend(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Query() query: PerformanceTrendQueryDto,
  ) {
    return this.service.getPerformanceTrend(tenantId, userId, query);
  }

  @Get('socket-ticket')
  socketTicket(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.mintSocketTicket(tenantId, userId);
  }
}