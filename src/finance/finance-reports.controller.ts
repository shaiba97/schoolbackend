import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { FinanceReportsService } from './finance-reports.service';

@ApiTags('Finance Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller()
@Roles('ACCOUNTANT')
export class FinanceReportsController {
  constructor(private service: FinanceReportsService) {}

  @Get('finance/reports/summary')
  summary(
    @CurrentTenant('tenantId') t: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.getSummary(t, from, to);
  }

  @Get('finance/reports/ledger')
  ledger(
    @CurrentTenant('tenantId') t: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('type') type?: string,
  ) {
    return this.service.getLedger(t, { from, to, type });
  }
}
