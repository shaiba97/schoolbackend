import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformHealthService } from './platform-health.service';

@ApiTags('Platform Health')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform/health')
export class PlatformHealthController {
  constructor(private platformHealthService: PlatformHealthService) {}

  @Get()
  report() {
    return this.platformHealthService.report();
  }
}
