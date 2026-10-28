import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { SupportContactsService } from './support-contacts.service';

/**
 * The unauthenticated support-contacts surface for the public marketing
 * site (landing page). The guarded /platform/support-contacts controller
 * stays console only; this one projects active contacts down to the
 * display fields the landing page renders (region, contact, contactType).
 * @Public() opts the route out of the app-wide deny-by-default
 * JwtAuthGuard; the read is non-mutating and exposes no identifiers.
 */
@ApiTags('Platform Public Support Contacts')
@Controller('platform/public')
export class SupportContactsPublicController {
  constructor(private supportContactsService: SupportContactsService) {}

  @Public()
  @ApiOperation({ summary: 'Active support contacts for the landing page' })
  @Get('support-contacts')
  supportContacts() {
    return this.supportContactsService.publicActive();
  }
}
