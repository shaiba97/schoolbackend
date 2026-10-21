import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MembershipsService } from './memberships.service';
import { CreateMembershipDto, UpdateMembershipDto } from './dto/membership.dto';
import { CreateAcademicAdminDto } from './dto/create-academic-admin.dto';
import { CreateGuardianDto } from '../students/dto/guardian.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination.dto';

@ApiTags('Memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('memberships')
export class MembershipsController {
  constructor(private service: MembershipsService) {}

  @Post('academic-admins')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  provisionAcademicAdmin(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateAcademicAdminDto,
  ) {
    return this.service.provisionAcademicAdmin(tenantId, dto);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateMembershipDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  findAll(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.service.findAll(tenantId, query.page, query.limit);
  }

  @Post('guardians')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  provisionGuardian(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateGuardianDto,
  ) {
    return this.service.provisionGuardian(tenantId, dto);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  update(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMembershipDto,
    @CurrentUser('userId') currentUserId: string,
  ) {
    return this.service.update(tenantId, id, dto, currentUserId);
  }
}
