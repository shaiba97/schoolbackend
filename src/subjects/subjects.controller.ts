import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SubjectsService } from './subjects.service';
import {
  AssignSubjectsToClassesDto,
  BatchCreateSubjectsDto,
  CreateSubjectDto,
  UpdateSubjectDto,
} from './dto/subject.dto';
import { CreateClassSubjectDto, UpdateClassSubjectDto } from './dto/class-subject.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination.dto';

@ApiTags('Subjects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('subjects')
export class SubjectsController {
  constructor(private service: SubjectsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  createSubject(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateSubjectDto,
  ) {
    return this.service.createSubject(tenantId, dto);
  }

  @Get()
  findAllSubjects(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.service.findAllSubjects(tenantId, query.page, query.limit);
  }

  /** Repeatable-row "add another subject" flow, optionally multi-assigning to classes. */
  @Post('batch')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  createSubjectsBatch(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: BatchCreateSubjectsDto,
  ) {
    return this.service.batchCreateSubjects(tenantId, dto);
  }

  /** Attach an existing subject to one or more classes. */
  @Post(':subjectId/assign-classes')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  assignToClasses(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('subjectId') subjectId: string,
    @Body() dto: AssignSubjectsToClassesDto,
  ) {
    return this.service.assignSubjectsToClasses(tenantId, subjectId, dto.classIds);
  }

  @Get(':id')
  findOneSubject(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOneSubject(tenantId, id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  updateSubject(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return this.service.updateSubject(tenantId, id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  deleteSubject(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteSubject(tenantId, id);
  }

  @Post('classes/:classId/assign')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  assignToClass(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('classId') classId: string,
    @Body() dto: CreateClassSubjectDto,
  ) {
    return this.service.assignSubjectToClass(tenantId, classId, dto);
  }

  @Get('classes/:classId')
  findClassSubjects(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('classId') classId: string,
  ) {
    return this.service.findClassSubjects(tenantId, classId);
  }

  @Put(':classSubjectId/teacher')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  updateTeacher(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('classSubjectId') classSubjectId: string,
    @Body() dto: UpdateClassSubjectDto,
  ) {
    return this.service.updateClassSubject(tenantId, classSubjectId, dto);
  }

  @Delete('class-subjects/:classSubjectId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  removeFromClass(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('classSubjectId') classSubjectId: string,
  ) {
    return this.service.removeSubjectFromClass(tenantId, classSubjectId);
  }
}
