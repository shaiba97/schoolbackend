import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformRoleGuard } from './platform-role.guard';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformOpsService } from './platform-ops.service';
import { PlatformProvisioningService } from './platform-provisioning.service';
import { PlatformFinancialsService } from './platform-financials.service';
import { PlatformFinancialsController } from './platform-financials.controller';
import { PlatformHealthService } from './platform-health.service';
import { PlatformHealthController } from './platform-health.controller';
import { PlatformPlansService } from './platform-plans.service';
import { PlatformPlansController } from './platform-plans.controller';
import { PlatformPlansPublicController } from './platform-plans-public.controller';
import { PlatformExpirationService } from './platform-expiration.service';
import {
  ManualPaymentGatewayAdapter,
  PaymentGatewayRegistry,
} from './payment-gateway.adapter';
import { PlatformAuditController } from './platform-audit.controller';
import { PlatformAnnouncementsController } from './platform-announcements.controller';

/**
 * Control-plane module. Never registers TenantGuard — every tenant-scoped
 * escape hatch it needs bypasses membership checks via the platform JWT scope.
 */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [
    PlatformAuthController,
    PlatformTenantsController,
    PlatformAuditController,
    PlatformAnnouncementsController,
    PlatformFinancialsController,
    PlatformPlansController,
    PlatformPlansPublicController,
    PlatformHealthController,
  ],
  providers: [
    PlatformAuthService,
    PlatformTenantsService,
    PlatformOpsService,
    PlatformProvisioningService,
    PlatformFinancialsService,
    PlatformPlansService,
    PlatformExpirationService,
    PlatformHealthService,
    ManualPaymentGatewayAdapter,
    PaymentGatewayRegistry,
    PlatformAdminGuard,
    PlatformRoleGuard,
  ],
  exports: [PlatformAdminGuard, PlatformRoleGuard],
})
export class PlatformModule {}
