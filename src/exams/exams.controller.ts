import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ExamsService, ExamActor } from './exams.service';
import { ExamSchedulingService } from './exam-scheduling.service';
import { ExamRoomsService } from './exam-rooms.service';
import { CreateExamDto, CreateExamSubjectDto, CreateRoomAssignmentDto, ReorderRoomStudentsDto, UpdateExamDto, BulkEnterMarksDto, UpdateRoomAssignmentDto } from './dto/exam.dto';
import { CreateSlotDto } from './dto/scheduling.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PaginatedYearQueryDto } from '../common/pagination/pagination.dto';

@ApiTags('Exams')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('exams')
export class ExamsController {
  constructor(
    private service: ExamsService,
    private scheduling: ExamSchedulingService,
    private rooms: ExamRoomsService,
  ) {}

  private actor(userId: string, tenant: { roles?: string[] }): ExamActor {
    return { userId, roles: tenant?.roles ?? [] };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN', 'TEACHER')
  create(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentTenant() tenant: { roles?: string[] },
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateExamDto,
  ) {
    return this.service.create(tenantId, dto, this.actor(userId, tenant));
  }

  @Get()
  findAll(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: PaginatedYearQueryDto,
  ) {
    return this.service.findAll(tenantId, query.yearId, query.page, query.limit);
  }

  // Static path declared before ':id' so it is never eaten by the parameter route.
  @Get('moderation-queue')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  moderationQueue(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.listModerationQueue(tenantId);
  }

  @Get(':id')
  findOne(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN', 'TEACHER')
  update(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentTenant() tenant: { roles?: string[] },
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExamDto,
  ) {
    return this.service.update(tenantId, id, dto, this.actor(userId, tenant));
  }

  @Post('subjects/:examSubjectId/marks')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN', 'TEACHER')
  enterMarks(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentTenant() tenant: { roles?: string[] },
    @CurrentUser('userId') userId: string,
    @Param('examSubjectId') examSubjectId: string,
    @Body() dto: BulkEnterMarksDto,
  ) {
    return this.service.enterMarks(tenantId, examSubjectId, dto, this.actor(userId, tenant));
  }

  @Post(':id/subjects')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  addSubject(    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateExamSubjectDto,
  ) {
    return this.service.addSubject(tenantId, id, dto);
  }

  @Delete(':id/subjects/:subjectId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  removeSubject(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Param('subjectId') subjectId: string,
  ) {
    return this.service.removeSubject(tenantId, id, subjectId);
  }

  @Get(':id/slots')
  listSlots(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.scheduling.listSlots(tenantId, id);
  }

  @Post(':id/slots')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  createSlot(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateSlotDto,
  ) {
    return this.scheduling.createSlot(tenantId, id, dto);
  }

  @Post(':id/publish')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  publish(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.publishResults(tenantId, id);
  }

  @Get(':id/analytics')
  getAnalytics(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.getAnalytics(tenantId, id);
  }

  @Get(':id/rooms')
  listRooms(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.rooms.listRooms(tenantId, id);
  }

  @Post(':id/rooms')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN', 'TEACHER')
  assignRoom(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentTenant() tenant: { roles?: string[] },
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateRoomAssignmentDto,
  ) {
    return this.rooms.assignRoom(tenantId, id, dto, this.actor(userId, tenant));
  }

  @Put(':id/rooms/:roomId/invigilators')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN', 'TEACHER')
  updateInvigilators(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentTenant() tenant: { roles?: string[] },
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomAssignmentDto,
  ) {
    return this.rooms.updateInvigilators(tenantId, id, roomId, dto, this.actor(userId, tenant));
  }

  @Put(':id/rooms/:roomId/students/order')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN', 'TEACHER')
  reorderStudents(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentTenant() tenant: { roles?: string[] },
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: ReorderRoomStudentsDto,
  ) {
    return this.rooms.reorderStudents(tenantId, id, roomId, dto, this.actor(userId, tenant));
  }

  @Delete(':id/rooms/:roomId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN', 'TEACHER')
  removeRoom(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentTenant() tenant: { roles?: string[] },
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('roomId') roomId: string,
  ) {
    return this.rooms.removeRoom(tenantId, id, roomId, this.actor(userId, tenant));
  }
}
