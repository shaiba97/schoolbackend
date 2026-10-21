import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { StaffService } from './staff.service';
import { CreateStaffDto, UpdateStaffDto, UpdateStaffStatusDto, StaffQueryDto, ResetStaffPasswordDto } from './dto/staff.dto';

@ApiTags('Staff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('staff')
export class StaffController {
  constructor(private service: StaffService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  list(
    @CurrentTenant('tenantId') tenantId: string,
    @Query() query: StaffQueryDto,
  ) {
    return this.service.list(tenantId, query);
  }

  @Get('next-number')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  previewStaffNumber(@Query('position') position: string) {
    return this.service.previewStaffNumber(position);
  }

  /**
   * Intentionally without RolesGuard: every staff portal (admin now, academic
   * affairs later) exchanges its session for a socket ticket. The gateway
   * still re-checks the ticket, and rooms stay identity-scoped (user +
   * school-wide), so no privilege crosses roles here.
   */
  @Get('me/socket-ticket')
  socketTicket(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.mintSocketTicket(tenantId, userId);
  }

  /**
   * Own-profile read, same boundary as the socket ticket above: no RolesGuard
   * because the requester is always the subject (identity from the JWT),
   * and the service only exposes the caller's ACTIVE membership.
   */
  @Get('me/profile')
  profile(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.getProfile(tenantId, userId);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  findOne(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  create(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateStaffDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  update(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.update(tenantId, id, dto, userId);
  }

  @Patch(':id/password')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  resetPassword(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: ResetStaffPasswordDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.resetPassword(tenantId, id, dto, userId);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  updateStatus(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStaffStatusDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.updateStatus(tenantId, id, dto, userId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SYSTEM_ADMIN')
  softDelete(
    @CurrentTenant('tenantId') tenantId: string,
    @Param('id') id: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.softDelete(tenantId, id, userId);
  }
}
