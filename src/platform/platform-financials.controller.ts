import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformRoleGuard, PlatformRoles } from './platform-role.guard';
import { platformActor } from './platform-actor';
import { PlatformFinancialsService } from './platform-financials.service';
import {
  ListPaymentsQueryDto,
  IssueReceiptDto,
  RecordPaymentDto,
} from './dto/platform-payments.dto';
import { LogExpenseDto, UpdateCurrencyDto } from './dto/financials.dto';

@ApiTags('Platform Financials')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform/financials')
export class PlatformFinancialsController {
  constructor(private platformFinancialsService: PlatformFinancialsService) {}

  @Get('overview')
  overview() {
    return this.platformFinancialsService.overview();
  }

  @Get('subscriptions')
  subscriptions() {
    return this.platformFinancialsService.subscriptions();
  }

  @Get('currencies')
  currencies() {
    return this.platformFinancialsService.currencies();
  }

  @Patch('currencies/:code')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  updateCurrency(
    @Param('code') code: string,
    @Body() dto: UpdateCurrencyDto,
    @Req() request: Request,
  ) {
    return this.platformFinancialsService.updateCurrency(
      code,
      dto,
      platformActor(request),
    );
  }

  @Get('expenses')
  expenses() {
    return this.platformFinancialsService.expenses();
  }

  @Post('expenses')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  logExpense(@Body() dto: LogExpenseDto, @Req() request: Request) {
    return this.platformFinancialsService.logExpense(
      dto,
      platformActor(request),
    );
  }

  @Get('payments')
  payments(@Query() query: ListPaymentsQueryDto) {
    return this.platformFinancialsService.payments(query.tenantId);
  }

  @Post('payments')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  recordPayment(@Body() dto: RecordPaymentDto, @Req() request: Request) {
    return this.platformFinancialsService.recordPayment(
      dto,
      platformActor(request),
    );
  }

  @Post('receipts')
  @UseGuards(PlatformRoleGuard)
  @PlatformRoles('SUPER_ADMIN')
  issueReceipt(@Body() dto: IssueReceiptDto, @Req() request: Request) {
    return this.platformFinancialsService.issueReceipt(
      dto,
      platformActor(request),
    );
  }
}
