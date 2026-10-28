import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { PlatformPlansService } from './platform-plans.service';

/**
 * The unauthenticated pricing surface for the public marketing site
 * (landing page). The guarded /platform/plans controller stays console
 * only; this one projects the tier catalogue down to display fields via
 * PlatformPlansService.publicPricingTiers. @Public() opts the route out of
 * the app-wide deny-by-default JwtAuthGuard; the service has no auth
 * context to validate and no mutation surface to guard.
 */
@ApiTags('Platform Public Pricing')
@Controller('platform/public')
export class PlatformPlansPublicController {
  constructor(private platformPlansService: PlatformPlansService) {}

  @Public()
  @ApiOperation({ summary: 'Public pricing tiers for the landing page' })
  @Get('pricing-tiers')
  pricingTiers() {
    return this.platformPlansService.publicPricingTiers();
  }
}
