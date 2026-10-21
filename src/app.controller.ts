import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Liveness, for a load balancer or an uptime check. It answers without
   * touching the database, so a database outage does not look like the
   * service being down. The detailed report lives behind the platform
   * guard at GET /api/platform/health.
   */
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
