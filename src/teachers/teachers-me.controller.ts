import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { TeachersMeService } from './teachers-me.service';
import { StaffAttendanceService } from '../staff-attendance/staff-attendance.service';
import {
  CreateTeacherAnnouncementDto,
  CreateTeacherSessionDto,
  ReturnSubjectMarksDto,
  TeacherBulkMarksDto,
  TeacherExamsQueryDto,
  TeacherMarkBulkDto,
  TeacherMeDateQueryDto,
  TeacherStudentsQueryDto,
} from './dto/teacher-me.dto';

/**
 * Teacher self-service surface. Every route derives the teacher from the
 * authenticated user (`sub` claim + X-Tenant-Id membership) — a teacherId is
 * never accepted as a parameter, so one teacher can only ever read or write
 * their own scope. Data that is admin-wide on the existing endpoints
 * (all classes, all sessions, all students) is re-derived here through the
 * teacher's own ClassSubject assignments.
 *
 * Declared ahead of the generic `teachers/:id` controller: route matching is
 * registration-order sensitive, and `me` would otherwise be eaten by the
 * parameterised route (its UUID pipe would reject it with a confusing 400).
 */
@ApiTags('Teachers (me)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('teachers/me')
export class TeachersMeController {
  constructor(
    private service: TeachersMeService,
    private staffAttendance: StaffAttendanceService,
  ) {}

  @Get('profile')
  getProfile(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.getProfile(tenantId, userId);
  }

  @Get('socket-ticket')
  socketTicket(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.mintSocketTicket(tenantId, userId);
  }

  @Get('payroll')
  myPayroll(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.myPayroll(tenantId, userId);
  }

  @Get('dashboard')
  getDashboard(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.getDashboard(tenantId, userId);
  }

  @Get('classes')
  listClasses(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.listClasses(tenantId, userId);
  }

  @Get('classes/:classId')
  getClassDetail(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('classId', new ParseUUIDPipe({ version: '4' })) classId: string,
  ) {
    return this.service.getClassDetail(tenantId, userId, classId);
  }

  @Get('timetable')
  getTimetable(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.getTimetable(tenantId, userId);
  }

  @Get('attendance-sessions')
  listAttendanceSessions(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Query() query: TeacherMeDateQueryDto,
  ) {
    return this.service.listAttendanceSessions(tenantId, userId, query.date);
  }

  @Post('attendance-sessions')
  createAttendanceSession(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateTeacherSessionDto,
  ) {
    return this.service.createAttendanceSession(tenantId, userId, dto);
  }

  @Get('attendance-sessions/:sessionId')
  getAttendanceSession(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ) {
    return this.service.getAttendanceSession(tenantId, userId, sessionId);
  }

  @Post('attendance-sessions/:sessionId/mark')
  markAttendanceSession(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @Body() dto: TeacherMarkBulkDto,
  ) {
    return this.service.markAttendanceSession(tenantId, userId, sessionId, dto.records);
  }

  @Get('attendance')
  myAttendance(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Query('month') month?: string,
  ) {
    return this.staffAttendance.listForTeacher(tenantId, userId, month);
  }

  @Get('exams')
  listExams(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Query() query: TeacherExamsQueryDto,
  ) {
    return this.service.listExams(tenantId, userId, query.scope);
  }

  @Get('exams/:examId')
  getExamDetail(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('examId', new ParseUUIDPipe({ version: '4' })) examId: string,
  ) {
    return this.service.getExamDetail(tenantId, userId, examId);
  }

  @Get('pending-marks')
  listPendingMarks(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.listPendingMarks(tenantId, userId);
  }

  @Post('exams/:examId/subjects/:examSubjectId/marks')
  enterMarks(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('examId', new ParseUUIDPipe({ version: '4' })) examId: string,
    @Param('examSubjectId', new ParseUUIDPipe({ version: '4' })) examSubjectId: string,
    @Body() dto: TeacherBulkMarksDto,
  ) {
    return this.service.enterMarks(tenantId, userId, examId, examSubjectId, dto.records);
  }

  @Post('exams/:examId/subjects/:examSubjectId/submit')
  submitSubjectMarks(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('examId', new ParseUUIDPipe({ version: '4' })) examId: string,
    @Param('examSubjectId', new ParseUUIDPipe({ version: '4' })) examSubjectId: string,
  ) {
    return this.service.submitSubjectMarks(tenantId, userId, examId, examSubjectId);
  }

  @Get('supervisor/queue')
  supervisorQueue(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.listSupervisorQueue(tenantId, userId);
  }

  @Post('supervisor/classes/:classId/exams/:examId/approve')
  approveClassExam(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('classId', new ParseUUIDPipe({ version: '4' })) classId: string,
    @Param('examId', new ParseUUIDPipe({ version: '4' })) examId: string,
  ) {
    return this.service.approveClassExam(tenantId, userId, examId, classId);
  }

  @Post('supervisor/classes/:classId/subjects/:examSubjectId/return')
  returnSubjectMarks(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('classId', new ParseUUIDPipe({ version: '4' })) classId: string,
    @Param('examSubjectId', new ParseUUIDPipe({ version: '4' })) examSubjectId: string,
    @Body() dto: ReturnSubjectMarksDto,
  ) {
    return this.service.returnSubjectMarks(tenantId, userId, classId, examSubjectId, dto.reason);
  }

  @Get('students')
  searchStudents(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Query() query: TeacherStudentsQueryDto,
  ) {
    return this.service.searchStudents(tenantId, userId, query.search, query.classId);
  }

  @Get('students/:studentId')
  getStudentDetail(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
  ) {
    return this.service.getStudentDetail(tenantId, userId, studentId);
  }

  @Post('announcements')
  createAnnouncement(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateTeacherAnnouncementDto,
  ) {
    return this.service.createAnnouncement(tenantId, userId, dto);
  }
}
