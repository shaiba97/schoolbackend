import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformOpsService } from './platform-ops.service';
import { ListAuditQueryDto } from './dto/list-audit-query.dto';

@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform/audit')
export class PlatformAuditController {
  constructor(private platformOpsService: PlatformOpsService) {}

  @Get()
  list(@Query() query: ListAuditQueryDto) {
    return this.platformOpsService.listAudit(query);
  }
}
