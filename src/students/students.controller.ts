import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { StudentsService } from './students.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/student.dto';
import { StudentQueryDto } from './dto/student-query.dto';
import { CreateStudentGuardianDto, LinkGuardianDto, UpdateStudentGuardianDto, UpdateStudentStatusDto } from './dto/guardian.dto';
import { EnrollStudentDto, UpdateEnrollmentDto } from './dto/enrollment.dto';
import { TransferStudentDto } from './dto/transfer-student.dto';
import { CreateAdmissionDto } from './dto/admission.dto';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@ApiTags('Students')
@ApiHeader({
  name: 'X-Tenant-Id',
  required: true,
  description: 'Tenant UUID for the current school',
})
@ApiBearerAuth()
@ApiSecurity('X-Tenant-Id')
// Every route here is staff-only. This guard is class-level on purpose: it was
// previously applied to POST /students/accounts alone, which left the other 24
// routes reachable with no token at all, since TenantGuard also never ran and
// @CurrentTenant fell back to the raw X-Tenant-Id header. Role-gate the whole
// controller so a new route is staff-only by default.
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles('ADMIN', 'ACADEMIC_ADMIN')
@Controller('students')
export class StudentsController {
  constructor(private service: StudentsService) {}

  @Post()
  create(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateStudentDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  @Post('accounts')
  @ApiBearerAuth()
  @ApiSecurity('X-Tenant-Id')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  createAccount(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateStudentDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  @Post('admissions')
  createAdmission(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateAdmissionDto,
  ) {
    return this.service.createAdmission(tenantId, dto);
  }

  @Get()
  findAll(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: StudentQueryDto,
  ) {
    return this.service.findAll(tenantId, query);
  }

  @Get('reference-data')
  referenceData(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.referenceData(tenantId);
  }

  @Get('enrollments')
  listEnrollments(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.listEnrollments(tenantId);
  }

  @Get('guardians')
  listGuardians(@CurrentTenant('tenantId') tenantId: string) {
    return this.service.listGuardians(tenantId);
  }

  @Get('guardians/search')
  searchGuardians(
    @CurrentTenant('tenantId') tenantId: string,
    @Query('q') q: string,
  ) {
    return this.service.searchGuardians(tenantId, q ?? '');
  }

  @Get('guardians/:guardianId')
  findOneGuardian(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('guardianId', new ParseUUIDPipe({ version: '4' })) guardianId: string,
  ) {
    return this.service.findOneGuardian(tenantId, guardianId);
  }

  @Get(':id')
  findOne(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Put(':id')
  update(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('confirm') confirm?: string,
  ) {
    return this.service.remove(tenantId, id, confirm);
  }

  @Post(':id/enrollments')
  enroll(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: EnrollStudentDto,
  ) {
    return this.service.enroll(tenantId, id, dto);
  }

  @Post(':id/transfer')
  transfer(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: TransferStudentDto,
  ) {
    return this.service.transferStudent(tenantId, id, dto.classId);
  }

  @Post(':id/graduate')
  graduate(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.graduateStudent(tenantId, id);
  }

  @Put(':id/enrollments/:enrollmentId')
  updateEnrollment(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('enrollmentId', new ParseUUIDPipe({ version: '4' }))
    enrollmentId: string,
    @Body() dto: UpdateEnrollmentDto,
  ) {
    return this.service.updateEnrollment(tenantId, id, enrollmentId, dto);
  }

  @Post(':id/guardians')
  linkGuardian(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: LinkGuardianDto,
  ) {
    return this.service.linkGuardian(tenantId, id, dto);
  }

  @Delete(':id/guardians/:guardianId')
  unlinkGuardian(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('guardianId', new ParseUUIDPipe({ version: '4' }))
    guardianId: string,
  ) {
    return this.service.unlinkGuardian(tenantId, id, guardianId);
  }

  @Get(':id/guardians')
  listStudentGuardians(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.listStudentGuardians(tenantId, id);
  }

  @Post(':id/guardians/new')
  createStudentGuardian(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateStudentGuardianDto,
  ) {
    return this.service.createStudentGuardian(tenantId, id, dto);
  }

  @Put(':id/guardians/:guardianId')
  updateStudentGuardian(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('guardianId', new ParseUUIDPipe({ version: '4' }))
    guardianId: string,
    @Body() dto: UpdateStudentGuardianDto,
  ) {
    return this.service.updateStudentGuardian(tenantId, id, guardianId, dto);
  }

  @Delete(':id/guardians/:guardianId/remove')
  removeStudentGuardian(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('guardianId', new ParseUUIDPipe({ version: '4' }))
    guardianId: string,
  ) {
    return this.service.removeStudentGuardian(tenantId, id, guardianId);
  }

  @Put(':id/status')
  updateStatus(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateStudentStatusDto,
  ) {
    return this.service.updateStatus(tenantId, id, dto);
  }

  @Get('results/board')
  listTenantResults(
    @CurrentTenant('tenantId') tenantId: string,
    @Query('examTypeId') examTypeId?: string,
  ) {
    return this.service.listTenantResults(tenantId, {
      examTypeId: examTypeId && examTypeId.trim() ? examTypeId.trim() : undefined,
    });
  }

  @Get(':id/results')
  listStudentResults(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.listStudentResults(tenantId, id);
  }

  @Get(':id/attendance-records')
  listStudentAttendanceRecords(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.listStudentAttendanceRecords(tenantId, id);
  }
}
