import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { SchoolAdminService } from './school-admin.service';
import {
  CreatePositionDto,
  RequestTierChangeDto,
  UpdateSchoolAdminProfileDto,
  UpdateSchoolTenantDto,
} from './dto/school-admin.dto';

/**
 * The school administrator's own workspace. Every route is scoped to the
 * tenant in the request: the administrator never names a school, so one
 * admin cannot reach another school's data by changing an id.
 */
@ApiTags('School Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('school-admin')
export class SchoolAdminController {
  constructor(private schoolAdminService: SchoolAdminService) {}

  @Get('overview')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  overview(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.schoolAdminService.overview(tenantId, userId);
  }

  @Patch('profile')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  updateProfile(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateSchoolAdminProfileDto,
  ) {
    return this.schoolAdminService.updateProfile(userId, dto);
  }

  @Patch('tenant')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  updateTenant(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: UpdateSchoolTenantDto,
  ) {
    return this.schoolAdminService.updateTenant(tenantId, dto);
  }

  @Post('positions')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  createPosition(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreatePositionDto,
  ) {
    return this.schoolAdminService.createPosition(tenantId, dto);
  }

  @Delete('positions/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  deletePosition(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.schoolAdminService.deletePosition(tenantId, id);
  }

  @Post('subscription/tier-request')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  requestTierChange(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: RequestTierChangeDto,
  ) {
    return this.schoolAdminService.requestTierChange(tenantId, userId, dto);
  }
}
