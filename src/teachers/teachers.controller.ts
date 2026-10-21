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
import { TeachersService } from './teachers.service';
import {
  CreateTeacherCredentialDto,
  CreateTeacherDto,
  TeacherQueryDto,
  UpdateTeacherCredentialDto,
  UpdateTeacherDto,
  UpdateTeacherStatusDto,
} from './dto/teacher.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';

@ApiTags('Teachers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('teachers')
export class TeachersController {
  constructor(private service: TeachersService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  create(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateTeacherDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  findAll(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: TeacherQueryDto,
  ) {
    return this.service.findAll(tenantId, query);
  }

  /**
   * Declared before `:id` — otherwise Nest matches the literal path against
   * the parameterised route and this never resolves.
   */
  @Get('next-employee-number')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  nextEmployeeNumber(
    @CurrentTenant('tenantId') tenantId: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.service.previewEmployeeNumber(tenantId, departmentId || undefined);
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
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  update(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTeacherDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  updateStatus(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTeacherStatusDto,
  ) {
    return this.service.updateStatus(tenantId, id, dto.status);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  delete(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(tenantId, id);
  }

  // Named credential documents. Readable by anyone who can see the teacher;
  // mutations are restricted to academic affairs, matching teacher edits.

  @Get(':id/credentials')
  listCredentials(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.listCredentials(tenantId, id);
  }

  @Post(':id/credentials')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  addCredential(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateTeacherCredentialDto,
  ) {
    return this.service.addCredential(tenantId, id, dto);
  }

  @Patch(':id/credentials/:credentialId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  updateCredential(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Param('credentialId') credentialId: string,
    @Body() dto: UpdateTeacherCredentialDto,
  ) {
    return this.service.updateCredential(tenantId, id, credentialId, dto);
  }

  @Delete(':id/credentials/:credentialId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ACADEMIC_ADMIN')
  deleteCredential(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Param('credentialId') credentialId: string,
  ) {
    return this.service.deleteCredential(tenantId, id, credentialId);
  }
}