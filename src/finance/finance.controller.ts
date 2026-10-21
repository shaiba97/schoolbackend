import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  FinanceCategoriesService, FinancePaymentsService,
  FinanceDiscountsService, FinanceExpensesService,
  FinanceCashService, FinanceControlsService, FinanceDashboardService,
} from './finance.service';
import {
  CreateFeeCategoryDto, UpdateFeeCategoryDto,
  CreatePaymentDto, ReversePaymentDto,
  CreateDiscountTypeDto, AssignDiscountDto,
  CreateScholarshipDto, AssignScholarshipDto,
  CreateExpenseCategoryDto, CreateExpenseDto, CreateRefundDto,
  CreateAccountDto, RecordTransactionDto, DailyClosingDto, BankReconciliationDto,
  CreatePeriodDto, CreatePaymentMethodDto,
} from './dto/finance.dto';
import { FINANCE_ROLES } from './finance-portal.roles';

export { FINANCE_ROLES };
export const FINANCE_WRITE = ['ACCOUNTANT'];
export const APPROVER_ROLES = ['ACCOUNTANT'];
export const CASHIER_ROLES = ['ACCOUNTANT'];

@ApiTags('Finance — Categories & Structures')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('finance')
export class FinanceCategoriesController {
  constructor(private service: FinanceCategoriesService) {}

  @Post('fee-categories')
  @Roles(...FINANCE_WRITE)
  createFeeCategory(@CurrentTenant('tenantId') t: string, @Body() dto: CreateFeeCategoryDto) {
    return this.service.createFeeCategory(t, dto);
  }

  @Get('fee-categories')
  @Roles(...FINANCE_ROLES)
  listFeeCategories(@CurrentTenant('tenantId') t: string) {
    return this.service.listFeeCategories(t);
  }

  @Put('fee-categories/:id')
  @Roles(...FINANCE_WRITE)
  updateFeeCategory(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Body() dto: UpdateFeeCategoryDto) {
    return this.service.updateFeeCategory(t, id, dto);
  }

  @Delete('fee-categories/:id')
  @Roles(...FINANCE_WRITE)
  deleteFeeCategory(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.deleteFeeCategory(t, id);
  }

  @Post('expense-categories')
  @Roles(...FINANCE_WRITE)
  createExpenseCategory(@CurrentTenant('tenantId') t: string, @Body() dto: CreateFeeCategoryDto) {
    return this.service.createExpenseCategory(t, dto);
  }

  @Get('expense-categories')
  @Roles(...FINANCE_ROLES)
  listExpenseCategories(@CurrentTenant('tenantId') t: string) {
    return this.service.listExpenseCategories(t);
  }
}

@ApiTags('Finance — Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('finance/payments')
export class FinancePaymentsController {
  constructor(private service: FinancePaymentsService) {}

  @Post(':id/reverse')
  @Roles(...APPROVER_ROLES)
  reverse(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string, @Body() dto: ReversePaymentDto) {
    return this.service.reversePayment(t, u, id, dto);
  }
}

@ApiTags('Finance — Discounts & Scholarships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('finance/discounts')
export class FinanceDiscountsController {
  constructor(private service: FinanceDiscountsService) {}

  @Post('types')
  @Roles(...FINANCE_WRITE)
  createType(@CurrentTenant('tenantId') t: string, @Body() dto: CreateDiscountTypeDto) {
    return this.service.createDiscountType(t, dto);
  }

  @Get('types')
  @Roles(...FINANCE_ROLES)
  listTypes(@CurrentTenant('tenantId') t: string) {
    return this.service.listDiscountTypes(t);
  }

  @Get('rules')
  @Roles(...FINANCE_ROLES)
  listRules(@CurrentTenant('tenantId') t: string) {
    return this.service.listDiscountRules(t);
  }

  @Post('scholarships')
  @Roles(...FINANCE_WRITE)
  createScholarship(@CurrentTenant('tenantId') t: string, @Body() dto: CreateScholarshipDto) {
    return this.service.createScholarship(t, dto);
  }

  @Get('scholarships')
  @Roles(...FINANCE_ROLES)
  listScholarships(@CurrentTenant('tenantId') t: string) {
    return this.service.listScholarships(t);
  }

  @Post('assign')
  @Roles(...FINANCE_WRITE)
  assignDiscount(@CurrentTenant('tenantId') t: string, @Body() dto: AssignDiscountDto) {
    return this.service.assignDiscount(t, dto);
  }

  @Post('scholarships/assign')
  @Roles(...FINANCE_WRITE)
  assignScholarship(@CurrentTenant('tenantId') t: string, @Body() dto: AssignScholarshipDto) {
    return this.service.assignScholarship(t, dto);
  }

  @Get('approvals')
  @Roles(...APPROVER_ROLES)
  approvals(@CurrentTenant('tenantId') t: string) {
    return this.service.listPendingApprovals(t);
  }

  @Post('approvals/discounts/:id/approve')
  @Roles(...APPROVER_ROLES)
  approveDiscount(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.approveDiscount(t, u, id);
  }

  @Post('approvals/discounts/:id/reject')
  @Roles(...APPROVER_ROLES)
  rejectDiscount(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.rejectDiscount(t, id);
  }

  @Get('topper-rules')
  @Roles(...FINANCE_ROLES)
  listTopperRules(@CurrentTenant('tenantId') t: string) {
    return this.service.listTopperRules(t);
  }

  @Post('topper-rules')
  @Roles(...FINANCE_WRITE)
  createTopperRule(
    @CurrentTenant('tenantId') t: string,
    @Body() dto: { name: string; valueType: string; value: number },
  ) {
    return this.service.createTopperRule(t, dto);
  }

  @Put('topper-rules/:id')
  @Roles(...FINANCE_WRITE)
  updateTopperRule(
    @CurrentTenant('tenantId') t: string,
    @Param('id') id: string,
    @Body() dto: { name?: string; valueType?: string; value?: number; isActive?: boolean },
  ) {
    return this.service.updateTopperRule(t, id, dto);
  }

  @Delete('topper-rules/:id')
  @Roles(...FINANCE_WRITE)
  deleteTopperRule(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.deleteTopperRule(t, id);
  }

  @Post('topper-rules/compute')
  @Roles(...FINANCE_WRITE)
  computeTopperAwards(@CurrentTenant('tenantId') t: string) {
    return this.service.computeTopperAwards(t);
  }
}

@ApiTags('Finance — Expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('finance/expenses')
export class FinanceExpensesController {
  constructor(private service: FinanceExpensesService) {}

  @Post(':id/pay')
  @Roles(...FINANCE_WRITE)
  pay(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.payExpense(t, id);
  }
}

@ApiTags('Finance — Refunds')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('finance/refunds')
export class FinanceRefundsController {
  constructor(private service: FinanceExpensesService) {}

  @Post()
  @Roles(...FINANCE_WRITE)
  create(@CurrentTenant('tenantId') t: string, @Body() dto: CreateRefundDto) {
    return this.service.createRefund(t, dto);
  }

  @Post(':id/process')
  @Roles(...APPROVER_ROLES)
  process(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.processRefund(t, u, id);
  }
}

@ApiTags('Finance — Cash & Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('finance/accounts')
export class FinanceCashController {
  constructor(private service: FinanceCashService) {}

  @Post()
  @Roles(...FINANCE_WRITE)
  create(@CurrentTenant('tenantId') t: string, @Body() dto: CreateAccountDto) {
    return this.service.createAccount(t, dto);
  }

  @Post('transactions')
  @Roles(...CASHIER_ROLES)
  transact(@CurrentTenant('tenantId') t: string, @Body() dto: RecordTransactionDto) {
    return this.service.recordTransaction(t, dto);
  }

  @Get(':id/transactions')
  @Roles(...FINANCE_ROLES)
  transactions(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.listTransactions(t, id);
  }

  @Post('closing')
  @Roles(...CASHIER_ROLES)
  close(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Body() dto: DailyClosingDto) {
    return this.service.dailyClosing(t, u, dto);
  }

  @Post('reconciliation')
  @Roles(...FINANCE_WRITE)
  reconcile(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Body() dto: BankReconciliationDto) {
    return this.service.createReconciliation(t, u, dto);
  }
}

@ApiTags('Finance — Controls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('finance/controls')
export class FinanceControlsController {
  constructor(private service: FinanceControlsService) {}

  @Post('periods')
  @Roles(...FINANCE_WRITE)
  createPeriod(@CurrentTenant('tenantId') t: string, @Body() dto: CreatePeriodDto) {
    return this.service.createPeriod(t, dto);
  }

  @Get('periods')
  @Roles(...FINANCE_ROLES)
  listPeriods(@CurrentTenant('tenantId') t: string) {
    return this.service.listPeriods(t);
  }

  @Post('periods/:id/close')
  @Roles(...FINANCE_WRITE)
  closePeriod(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.closePeriod(t, u, id);
  }

  @Post('payment-methods')
  @Roles(...FINANCE_WRITE)
  createMethod(@CurrentTenant('tenantId') t: string, @Body() dto: CreatePaymentMethodDto) {
    return this.service.createPaymentMethod(t, dto);
  }

  @Get('payment-methods')
  @Roles(...FINANCE_ROLES)
  listMethods(@CurrentTenant('tenantId') t: string) {
    return this.service.listPaymentMethods(t);
  }

  @Get('audit-logs')
  @Roles(...FINANCE_ROLES, 'ADMIN')
  auditLogs(@CurrentTenant('tenantId') t: string) {
    return this.service.listAuditLogs(t);
  }
}

@ApiTags('Finance — Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller('finance/dashboard')
export class FinanceDashboardController {
  constructor(private service: FinanceDashboardService) {}

  @Get('stats')
  @Roles(...FINANCE_ROLES)
  stats(@CurrentTenant('tenantId') t: string) {
    return this.service.getStats(t);
  }

  @Get('socket-ticket')
  @Roles(...FINANCE_ROLES)
  socketTicket(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string) {
    return this.service.mintSocketTicket(t, u);
  }
}
