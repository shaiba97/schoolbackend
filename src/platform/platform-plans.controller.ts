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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformRoleGuard, PlatformRoles } from './platform-role.guard';
import { platformActor } from './platform-actor';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformExpirationService } from './platform-expiration.service';
import {
  CreateTierDto,
  RenewSubscriptionDto,
  UpdateTierDto,
  UpgradeSubscriptionDto,
} from './dto/plans.dto';

@ApiTags('Platform Plans')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform/plans')
export class PlatformPlansController {
  constructor(
    private platformPlansService: PlatformPlansService,
    private platformExpirationService: PlatformExpirationService,
  ) {}

  @Get()
  tiers() {
    return this.platformPlansService.listTiers();
  }

  @Post()
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  createTier(@Body() dto: CreateTierDto, @Req() request: Request) {
    return this.platformPlansService.createTier(dto, platformActor(request));
  }

  @Patch(':id')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  updateTier(
    @Param('id') id: string,
    @Body() dto: UpdateTierDto,
    @Req() request: Request,
  ) {
    return this.platformPlansService.updateTier(id, dto, platformActor(request));
  }

  @Delete(':id')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  deleteTier(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.platformPlansService.deleteTier(id, platformActor(request));
  }

  @Get('subscriptions')
  subscriptions() {
    return this.platformPlansService.subscriptions();
  }
  @Post('subscriptions/:tenantId/renew')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  renew(
    @Param('tenantId') tenantId: string,
    @Body() dto: RenewSubscriptionDto,
    @Req() request: Request,
  ) {
    return this.platformPlansService.renew(tenantId, dto, platformActor(request));
  }

  @Post('subscriptions/:tenantId/terminate')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  terminate(@Param('tenantId') tenantId: string, @Req() request: Request) {
    return this.platformPlansService.terminate(tenantId, platformActor(request));
  }

  @Post('subscriptions/:tenantId/upgrade')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  upgrade(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpgradeSubscriptionDto,
    @Req() request: Request,
  ) {
    return this.platformPlansService.upgrade(tenantId, dto, platformActor(request));
  }

  @Post('expiration-audit')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  expirationAudit() {
    return this.platformExpirationService.sweep();
  }
}
