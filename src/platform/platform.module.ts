import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformRoleGuard } from './platform-role.guard';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformOpsService } from './platform-ops.service';
import { PlatformProvisioningService } from './platform-provisioning.service';
import { PlatformAuditController } from './platform-audit.controller';
import { PlatformAnnouncementsController } from './platform-announcements.controller';

/**
 * Control-plane module. Never registers TenantGuard — every tenant-scoped
 * escape hatch it needs bypasses membership checks via the platform JWT scope.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    PlatformAuthController,
    PlatformTenantsController,
    PlatformAuditController,
    PlatformAnnouncementsController,
  ],
  providers: [
    PlatformAuthService,
    PlatformTenantsService,
    PlatformOpsService,
    PlatformProvisioningService,
    PlatformAdminGuard,
    PlatformRoleGuard,
  ],
  exports: [PlatformAdminGuard, PlatformRoleGuard],
})
export class PlatformModule {}
