import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/notification.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(
    @CurrentTenant('tenantId') tenantId: string,
    @Body() dto: CreateNotificationDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  @Get('me')
  findMyNotifications(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.findMyNotifications(tenantId, userId);
  }

  @Put(':id/read')
  markAsRead(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.markAsRead(tenantId, id, userId);
  }

  @Put('read-all')
  markAllRead(
    @CurrentTenant('tenantId') tenantId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.markAllRead(tenantId, userId);
  }
}
