import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { ReceptionistService } from './receptionist.service';
import {
  ReceptionistAttendanceQueryDto,
  MarkAttendanceDto,
  ReceptionistProfileResponseDto,
  AttendanceListResponseDto,
  MarkAttendanceResponseDto,
  SocketTicketResponseDto,
} from './dto/receptionist-attendance.dto';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string; tenantId?: string; roles?: string[] };
}

@ApiTags('receptionist')
@ApiBearerAuth()
@Controller('receptionist')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('RECEPTIONIST', 'ADMIN')
export class ReceptionistController {
  constructor(private readonly service: ReceptionistService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get receptionist profile' })
  async getProfile(
    @Request() req: AuthenticatedRequest,
    @CurrentTenant('tenantId') tenantId: string,
  ): Promise<ReceptionistProfileResponseDto> {
    const userId = req.user.userId;
    return this.service.getProfile(tenantId, userId);
  }

  @Get('attendance')
  @ApiOperation({
    summary: 'Get attendance list for staff, teachers, or students',
  })
  @ApiQuery({
    name: 'type',
    enum: ['staff', 'teacher', 'student'],
    required: true,
  })
  @ApiQuery({ name: 'date', required: false, example: '2026-10-18' })
  async getAttendanceList(
    @Request() req: AuthenticatedRequest,
    @Query() query: ReceptionistAttendanceQueryDto,
    @CurrentTenant('tenantId') tenantId: string,
  ): Promise<AttendanceListResponseDto> {
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    return this.service.getAttendanceList(tenantId, query.type, date);
  }

  @Post('attendance/mark')
  @ApiOperation({ summary: 'Mark attendance for staff, teacher, or student' })
  async markAttendance(
    @Request() req: AuthenticatedRequest,
    @Body() dto: MarkAttendanceDto,
    @CurrentTenant('tenantId') tenantId: string,
  ): Promise<MarkAttendanceResponseDto> {
    const markedById = req.user.userId;
    return this.service.markAttendance(tenantId, markedById, dto);
  }

  @Get('socket-ticket')
  @ApiOperation({ summary: 'Get socket ticket for realtime connection' })
  async getSocketTicket(
    @Request() req: AuthenticatedRequest,
    @CurrentTenant('tenantId') tenantId: string,
  ): Promise<SocketTicketResponseDto> {
    const userId = req.user.userId;
    return this.service.mintSocketTicket(tenantId, userId);
  }
}
