import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PortalModule } from '@prisma/client';
import type { PortalModule as PortalModuleType } from '@prisma/client';
import type { Request } from 'express';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformRoleGuard, PlatformRoles } from './platform-role.guard';
import { platformActor } from './platform-actor';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformProvisioningService } from './platform-provisioning.service';
import { ListTenantsQueryDto } from './dto/list-tenants-query.dto';
import { ProvisionTenantDto } from './dto/provision-tenant.dto';
import { SetToggleDto } from './dto/set-toggle.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';

const FLAG_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/;

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform')
export class PlatformTenantsController {
  constructor(
    private platformTenantsService: PlatformTenantsService,
    private platformProvisioningService: PlatformProvisioningService,
  ) {}

  @Get('stats')
  stats() {
    return this.platformTenantsService.stats();
  }

  @Get('plans')
  plans() {
    return this.platformTenantsService.listPlans();
  }

  @Get('tenants')
  list(@Query() query: ListTenantsQueryDto) {
    return this.platformTenantsService.list(query);
  }

  @Post('tenants')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  provision(@Body() dto: ProvisionTenantDto, @Req() request: Request) {
    return this.platformProvisioningService.provision(dto, platformActor(request));
  }

  @Get('tenants/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.platformTenantsService.detail(id);
  }

  @Patch('tenants/:id/status')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantStatusDto,
    @Req() request: Request,
  ) {
    return this.platformTenantsService.updateStatus(
      id,
      dto.status,
      platformActor(request),
    );
  }

  @Patch('tenants/:id/modules/:module')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  setModule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('module', new ParseEnumPipe(PortalModule)) module: PortalModuleType,
    @Body() dto: SetToggleDto,
    @Req() request: Request,
  ) {
    return this.platformTenantsService.setModule(
      id,
      module,
      dto.enabled,
      platformActor(request),
    );
  }

  @Patch('tenants/:id/flags/:key')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  setFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('key') key: string,
    @Body() dto: SetToggleDto,
    @Req() request: Request,
  ) {
    if (!FLAG_KEY_PATTERN.test(key)) {
      throw new BadRequestException('Invalid feature flag key');
    }
    return this.platformTenantsService.setFlag(
      id,
      key,
      dto.enabled,
      platformActor(request),
    );
  }
}
