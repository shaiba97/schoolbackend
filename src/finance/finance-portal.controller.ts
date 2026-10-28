import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PERMISSIONS, hasPermission } from '../auth/permissions';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { FinancePortalService } from './finance-portal.service';
import {
  CreateFeeCategoryDto, UpdateFeeCategoryDto, CreateFeeStructureDto, UpdateFeeStructureDto,
  CreateThresholdDto, UpdateThresholdDto, UpdatePaymentMethodDto, UpdateFinanceSettingsDto,
  CreatePeriodDto,
} from './dto/finance.dto';

import {
  FINANCE_PORTAL_APPROVER as APPROVER,
  FINANCE_PORTAL_CASHIER_WRITE as CASHIER_WRITE,
  FINANCE_PORTAL_READ as READ,
  FINANCE_PORTAL_WRITE as WRITE,
} from './finance-portal.roles';

@ApiTags('Finance Portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller()
export class FinancePortalController {
  constructor(private service: FinancePortalService) {}

  @Get('fees/categories')
  @Roles(...READ)
  feeCategories(@CurrentTenant('tenantId') t: string) {
    return this.service.listCategories(t);
  }

  @Post('fees/categories')
  @Roles(...WRITE)
  createFeeCategory(@CurrentTenant('tenantId') t: string, @Body() dto: CreateFeeCategoryDto) {
    return this.service.createCategory(t, dto);
  }

  @Put('fees/categories/:id')
  @Roles(...WRITE)
  updateFeeCategory(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Body() dto: UpdateFeeCategoryDto) {
    return this.service.updateCategory(t, id, dto);
  }

  @Delete('fees/categories/:id')
  @Roles(...WRITE)
  deleteFeeCategory(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.deleteCategory(t, id);
  }

  @Get('fees/structures')
  @Roles(...READ)
  feeStructures(@CurrentTenant('tenantId') t: string) {
    return this.service.listStructures(t);
  }

  @Get('fees/students')
  @Roles(...READ)
  listAssignableStudents(
    @CurrentTenant('tenantId') t: string,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
    @Query('q') q?: string,
  ) {
    return this.service.listAssignableStudents(t, Number(page), Number(pageSize), q);
  }

  @Get('fees/students/:id/schedule')
  @Roles(...READ)
  studentSchedule(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.getStudentSchedule(t, id);
  }

  @Post('fees/assign')
  @Roles(...WRITE)
  assignFeeStructure(
    @CurrentTenant('tenantId') t: string,
    @Body() dto: { studentId: string; feeStructureId: string; classId?: string },
  ) {
    return this.service.assignFeeStructure(t, dto);
  }

  @Get('fees/classes')
  @Roles(...READ)
  listAssignableClasses(@CurrentTenant('tenantId') t: string) {
    return this.service.listAssignableClasses(t);
  }

  @Get('fees/academic-years')
  @Roles(...READ)
  listAcademicYears(@CurrentTenant('tenantId') t: string) {
    return this.service.listAcademicYears(t);
  }

  @Post('fees/structures')
  @Roles(...WRITE)
  createFeeStructure(@CurrentTenant('tenantId') t: string, @Body() dto: CreateFeeStructureDto) {
    return this.service.createStructure(t, dto);
  }

  @Put('fees/structures/:id')
  @Roles(...WRITE)
  updateFeeStructure(
    @CurrentTenant('tenantId') t: string,
    @Param('id') id: string,
    @Body() dto: UpdateFeeStructureDto,
  ) {
    return this.service.updateStructure(t, id, dto);
  }

  @Post('fees/structures/:id/archive')
  @Roles(...WRITE)
  archiveFeeStructure(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.archiveStructure(t, id);
  }

  @Post('fees/structures/:id/unarchive')
  @Roles(...WRITE)
  unarchiveFeeStructure(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.unarchiveStructure(t, id);
  }

  @Delete('fees/structures/:id')
  @Roles(...WRITE)
  deleteFeeStructure(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.deleteStructure(t, id);
  }

  @Get('finance/payments')
  @Roles(...READ)
  payments(
    @CurrentTenant('tenantId') t: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listPayments(t, status, limit ? Number(limit) : undefined);
  }

  @Post('finance/payments')
  @Roles(...CASHIER_WRITE)
  recordPayment(@CurrentTenant('tenantId') t: string, @Body() dto: { studentId: string; allocations: { installmentNo?: number | null; kind: string; amount: number }[]; method: string; transactionId?: string; notes?: string; discountIds?: string[] }) {
    return this.service.recordPayment(t, dto);
  }

  @Post('finance/payments/pay-all')
  @Roles(...CASHIER_WRITE)
  payAllOutstanding(@CurrentTenant('tenantId') t: string, @Body() dto: { studentId: string; method: string; transactionId?: string; notes?: string; discountIds?: string[] }) {
    return this.service.recordPaymentAllOutstanding(t, dto);
  }

  @Post('finance/payments/:id/verify')
  @Roles(...APPROVER)
  verifyPayment(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.verifyPayment(t, id);
  }

  @Get('finance/payments/:id/receipt')
  @Roles(...READ)
  async getPaymentReceipt(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    const { buffer, filename } = await this.service.getPaymentReceipt(t, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('finance/discounts')
  @Roles(...READ)
  discounts(@CurrentTenant('tenantId') t: string) {
    return this.service.listDiscounts(t);
  }

  @Get('finance/student-discounts')
  @Roles(...READ)
  studentDiscounts(@CurrentTenant('tenantId') t: string, @Query('status') status?: string) {
    return this.service.listStudentDiscounts(t, status);
  }

  @Post('finance/student-discounts/:id/approve')
  @Roles(...APPROVER)
  approveStudentDiscount(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.approveStudentDiscount(t, u, id);
  }

  @Post('finance/student-discounts/:id/reject')
  @Roles(...APPROVER)
  rejectStudentDiscount(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.rejectStudentDiscount(t, id);
  }

  // Unified assigned-discounts ledger for the 2-tab workspace. Reason
  // redaction mirrors FinanceFamilyController: only callers holding
  // FAMILY_CONDITION_VIEW see family-condition notes.
  @Get('finance/discounts/assigned')
  @Roles(...READ)
  assignedDiscounts(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Req() req: any) {
    const roles = req.tenant?.roles || req.user?.roles || [];
    return this.service.listAssignedDiscounts(t, u, hasPermission(roles, PERMISSIONS.FAMILY_CONDITION_VIEW));
  }

  @Get('finance/students/:id/ledger')
  @Roles(...READ)
  studentLedger(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.getStudentLedger(t, id);
  }

  @Get('finance/students/:id/eligible-discounts')
  @Roles(...READ)
  eligibleDiscounts(
    @CurrentTenant('tenantId') t: string,
    @Param('id') id: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.service.listEligibleDiscounts(t, id, academicYearId);
  }

  @Get('finance/expenses')
  @Roles(...READ)
  expenses(@CurrentTenant('tenantId') t: string, @Query('status') status?: string) {
    return this.service.listExpenses(t, status);
  }

  @Post('finance/expenses')
  @Roles(...WRITE)
  createExpense(
    @CurrentTenant('tenantId') t: string,
    @Body() dto: { category: string; amount: number; title?: string; description?: string; vendor?: string; date?: string },
  ) {
    return this.service.createExpense(t, dto);
  }

  @Put('finance/expenses/:id')
  @Roles(...WRITE)
  updateExpense(
    @CurrentTenant('tenantId') t: string,
    @Param('id') id: string,
    @Body() dto: { category?: string; amount?: number; title?: string; vendor?: string; date?: string },
  ) {
    return this.service.updateExpense(t, id, dto);
  }

  @Delete('finance/expenses/:id')
  @Roles(...WRITE)
  deleteExpense(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.deleteExpense(t, id);
  }

  @Post('finance/expenses/:id/approve')
  @Roles(...APPROVER)
  approveExpense(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.approveExpense(t, u, id);
  }

  @Post('finance/expenses/:id/reject')
  @Roles(...APPROVER)
  rejectExpense(
    @CurrentTenant('tenantId') t: string,
    @Param('id') id: string,
    @Body() dto: { reason?: string },
  ) {
    return this.service.rejectExpense(t, id, dto?.reason);
  }

  @Get('finance/refunds')
  @Roles(...READ)
  refunds(@CurrentTenant('tenantId') t: string) {
    return this.service.listRefunds(t);
  }

  @Get('finance/accounts')
  @Roles(...READ)
  accounts(@CurrentTenant('tenantId') t: string) {
    return this.service.listAccounts(t);
  }

  @Get('finance/cashbook')
  @Roles(...READ)
  cashbook(@CurrentTenant('tenantId') t: string) {
    return this.service.listCashbook(t);
  }

  @Get('finance/closings')
  @Roles(...READ)
  closings(@CurrentTenant('tenantId') t: string) {
    return this.service.listClosings(t);
  }

  @Get('finance/closings/expected')
  @Roles(...READ)
  expectedCash(
    @CurrentTenant('tenantId') t: string,
    @Query('accountId') accountId: string,
    @Query('date') date?: string,
  ) {
    return this.service.getExpectedCash(t, accountId, date);
  }

  @Post('finance/closings')
  @Roles(...CASHIER_WRITE)
  createClosing(
    @CurrentTenant('tenantId') t: string,
    @CurrentUser('userId') u: string,
    @Body() dto: { accountId: string; date?: string; countedAmount: number; notes?: string },
  ) {
    return this.service.createClosing(t, u, dto);
  }

  @Get('finance/transfers')
  @Roles(...READ)
  transfers(@CurrentTenant('tenantId') t: string) {
    return this.service.listTransfers(t);
  }

  @Post('finance/transfers')
  @Roles(...CASHIER_WRITE)
  createTransfer(
    @CurrentTenant('tenantId') t: string,
    @CurrentUser('userId') u: string,
    @Body() dto: { fromAccountId: string; toAccountId: string; amount: number; reference?: string; notes?: string },
  ) {
    return this.service.createTransfer(t, u, dto);
  }

  @Get('finance/periods')
  @Roles(...READ)
  periods(@CurrentTenant('tenantId') t: string) {
    return this.service.listPeriods(t);
  }

  @Get('finance/payment-methods')
  @Roles(...READ)
  paymentMethods(@CurrentTenant('tenantId') t: string) {
    return this.service.listPaymentMethods(t);
  }

  @Get('finance/settings')
  @Roles(...READ)
  settings(@CurrentTenant('tenantId') t: string) {
    return this.service.getSettings(t);
  }

  @Put('finance/settings')
  @Roles(...WRITE)
  updateSettings(@CurrentTenant('tenantId') t: string, @Body() dto: UpdateFinanceSettingsDto) {
    return this.service.updateSettings(t, dto);
  }

  @Post('finance/periods')
  @Roles(...WRITE)
  createPeriod(@CurrentTenant('tenantId') t: string, @Body() dto: CreatePeriodDto) {
    return this.service.createPeriod(t, dto);
  }

  @Post('finance/periods/:id/lock')
  @Roles(...WRITE)
  lockPeriod(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.setPeriodLock(t, u, id, true);
  }

  @Post('finance/periods/:id/unlock')
  @Roles(...WRITE)
  unlockPeriod(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.setPeriodLock(t, u, id, false);
  }

  @Put('finance/payment-methods/:id')
  @Roles(...WRITE)
  updateMethod(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Body() dto: UpdatePaymentMethodDto) {
    if (dto.isActive !== undefined && (dto.accountName !== undefined || dto.accountNumber !== undefined)) {
      throw new BadRequestException('Update active flag and account details separately');
    }
    if (dto.isActive !== undefined) return this.service.setMethodActive(t, id, dto.isActive);
    return this.service.setMethodDetails(t, id, dto);
  }

  @Get('finance/approval-thresholds')
  @Roles(...READ)
  thresholds(@CurrentTenant('tenantId') t: string) {
    return this.service.listThresholds(t);
  }

  @Post('finance/approval-thresholds')
  @Roles(...WRITE)
  createThreshold(@CurrentTenant('tenantId') t: string, @Body() dto: CreateThresholdDto) {
    return this.service.createThreshold(t, dto);
  }

  @Put('finance/approval-thresholds/:id')
  @Roles(...WRITE)
  updateThreshold(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Body() dto: UpdateThresholdDto) {
    return this.service.updateThreshold(t, id, dto);
  }

  @Delete('finance/approval-thresholds/:id')
  @Roles(...WRITE)
  deleteThreshold(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.deleteThreshold(t, id);
  }

  @Get('finance/dashboard')
  @Roles(...READ)
  dashboard(@CurrentTenant('tenantId') t: string) {
    return this.service.getDashboard(t);
  }

  @Get('finance/collections/summary')
  @Roles(...READ)
  collections(@CurrentTenant('tenantId') t: string) {
    return this.service.getCollectionsSummary(t);
  }

  @Get('finance/student-profiles')
  @Roles(...READ)
  profiles(@CurrentTenant('tenantId') t: string) {
    return this.service.getFinancialProfiles(t);
  }
}
