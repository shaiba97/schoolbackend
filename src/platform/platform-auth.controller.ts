import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformAdminGuard } from './platform-admin.guard';

@ApiTags('Platform')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private platformAuthService: PlatformAuthService) {}

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() dto: PlatformLoginDto) {
    return this.platformAuthService.platformLogin(dto);
  }

  @ApiBearerAuth()
  @UseGuards(PlatformAdminGuard)
  @Get('me')
  me(@CurrentUser('userId') userId: string) {
    return this.platformAuthService.platformMe(userId);
  }
}
