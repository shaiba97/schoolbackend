import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../common/tenant/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermission } from '../auth/permissions.decorator';
import { PERMISSIONS, hasPermission } from '../auth/permissions';
import { CurrentTenant } from '../common/tenant/current-tenant.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { FinancePayrollService } from './finance-payroll.service';
import { AssignStaffSalaryDto, CreateFamilyConditionDto, CreateSiblingRuleDto, PaySalaryDto, SetSalaryOverrideDto, SetShortageRatesDto, UpsertPositionSalaryDto } from './dto/finance.dto';

export const READ = ['ACCOUNTANT'];
export const WRITE = ['ACCOUNTANT'];
export const APPROVER = ['ACCOUNTANT'];

@ApiTags('Finance Payroll')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiSecurity('X-Tenant-Id')
@Controller()
export class FinancePayrollController {
  constructor(private service: FinancePayrollService) {}

  // --- Positions ---
  // Academic Affairs callers are allowed here: the service scopes them to
  // teacher positions only. Writes stay ACCOUNTANT-only below.
  @Get('finance/positions')
  @Roles('ACCOUNTANT', 'TEACHER', 'ACADEMIC_AFFAIRS')
  positions(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string) {
    return this.service.listPositions(t, u);
  }

  @Get('finance/departments')
  @Roles(...READ)
  departments(@CurrentTenant('tenantId') t: string) {
    return this.service.listDepartments(t);
  }

  @Post('finance/positions')
  @Roles(...WRITE)
  createPosition(@CurrentTenant('tenantId') t: string, @Body() dto: any) {
    return this.service.createPosition(t, dto);
  }

  @Put('finance/positions/:id')
  @Roles(...WRITE)
  updatePosition(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Body() dto: any) {
    return this.service.updatePosition(t, id, dto);
  }

  @Delete('finance/positions/:id')
  @Roles(...WRITE)
  deletePosition(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.deletePosition(t, id);
  }

  // --- Deduction rules ---
  @Get('finance/deduction-rules')
  @Roles(...READ)
  deductionRules(@CurrentTenant('tenantId') t: string) {
    return this.service.listDeductionRules(t);
  }

  @Post('finance/deduction-rules')
  @Roles(...WRITE)
  createDeductionRule(@CurrentTenant('tenantId') t: string, @Body() dto: any) {
    return this.service.createDeductionRule(t, dto);
  }

  @Put('finance/deduction-rules/:id')
  @Roles(...WRITE)
  updateDeductionRule(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Body() dto: any) {
    return this.service.updateDeductionRule(t, id, dto);
  }

  @Delete('finance/deduction-rules/:id')
  @Roles(...WRITE)
  deleteDeductionRule(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.deleteDeductionRule(t, id);
  }

  // --- Staff assignments / employees ---
  @Get('finance/staff-position-assignments')
  @Roles(...READ)
  assignments(@CurrentTenant('tenantId') t: string) {
    return this.service.listAssignments(t);
  }

  @Get('finance/employees')
  @Roles(...READ)
  employees(@CurrentTenant('tenantId') t: string) {
    return this.service.listEmployees(t);
  }

  @Post('finance/staff-position-assignments')
  @Roles(...WRITE)
  assignStaff(@CurrentTenant('tenantId') t: string, @Body() dto: any) {
    return this.service.assignStaff(t, dto);
  }

  @Post('finance/staff-position-assignments/:id/end')
  @Roles(...WRITE)
  endAssignment(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Body() dto: any) {
    return this.service.endAssignment(t, id, dto?.endDate);
  }

  // --- Payouts ---
  @Get('finance/salary-payouts')
  @Roles(...READ)
  payouts(@CurrentTenant('tenantId') t: string, @Query('status') status?: string) {
    return this.service.listPayouts(t, status);
  }

  @Post('finance/salary-payouts')
  @Roles(...WRITE)
  createPayout(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Body() dto: any) {
    return this.service.createPayout(t, u, dto);
  }

  @Post('finance/salary-payouts/generate-batch')
  @Roles(...WRITE)
  generateBatch(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Body() dto: any) {
    return this.service.generateBatch(t, u, dto);
  }

  @Post('finance/salary-payouts/:id/deductions')
  @Roles(...WRITE)
  addDeduction(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Body() dto: any) {
    return this.service.addPayoutDeduction(t, id, dto);
  }

  @Delete('finance/salary-payouts/:id/deductions/:deductionId')
  @Roles(...WRITE)
  removeDeduction(
    @CurrentTenant('tenantId') t: string,
    @Param('id') id: string,
    @Param('deductionId') deductionId: string,
  ) {
    return this.service.removePayoutDeduction(t, id, deductionId);
  }

  @Post('finance/salary-payouts/:id/approve')
  @Roles(...APPROVER)
  approvePayout(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.approvePayout(t, u, id);
  }

  @Post('finance/salary-payouts/:id/pay')
  @Roles(...APPROVER)
  payPayout(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string, @Body() dto: any) {
    return this.service.payPayout(t, u, id, dto ?? {});
  }

  @Post('finance/salary-payouts/:id/cancel')
  @Roles(...APPROVER)
  cancelPayout(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.cancelPayout(t, u, id);
  }

  @Get('finance/salary-payouts/:id/payslip')
  @Roles(...READ)
  async payslip(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    const { buffer, filename } = await this.service.getPayslip(t, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  // --- Sibling groups & rules ---
  @Get('finance/sibling-groups')
  @Roles(...READ)
  siblingGroups(@CurrentTenant('tenantId') t: string) {
    return this.service.listSiblingGroups(t);
  }

  @Post('finance/sibling-groups')
  @Roles(...WRITE)
  createSiblingGroup(@CurrentTenant('tenantId') t: string, @Body() dto: any) {
    return this.service.createSiblingGroup(t, dto);
  }

  @Post('finance/sibling-groups/:id/members')
  @Roles(...WRITE)
  addSiblingMember(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Body() dto: any) {
    return this.service.addSiblingMember(t, id, dto.studentId);
  }

  @Delete('finance/sibling-groups/:id/members/:studentId')
  @Roles(...WRITE)
  removeSiblingMember(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Param('studentId') studentId: string) {
    return this.service.removeSiblingMember(t, id, studentId);
  }

  @Delete('finance/sibling-groups/:id')
  @Roles(...WRITE)
  deleteSiblingGroup(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.deleteSiblingGroup(t, id);
  }

  @Get('finance/sibling-discount-rules')
  @Roles(...READ)
  siblingRules(@CurrentTenant('tenantId') t: string) {
    return this.service.listSiblingRules(t);
  }

  @Post('finance/sibling-discount-rules')
  @Roles(...WRITE)
  createSiblingRule(@CurrentTenant('tenantId') t: string, @Body() dto: CreateSiblingRuleDto) {
    return this.service.createSiblingRule(t, dto);
  }

  @Put('finance/sibling-discount-rules/:id')
  @Roles(...WRITE)
  updateSiblingRule(@CurrentTenant('tenantId') t: string, @Param('id') id: string, @Body() dto: any) {
    return this.service.updateSiblingRule(t, id, dto);
  }

  @Delete('finance/sibling-discount-rules/:id')
  @Roles(...WRITE)
  deleteSiblingRule(@CurrentTenant('tenantId') t: string, @Param('id') id: string) {
    return this.service.deleteSiblingRule(t, id);
  }

  @Post('finance/sibling-discounts/sync')
  @Roles(...WRITE)
  syncSiblingDiscounts(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string) {
    return this.service.syncSiblingDiscounts(t, u);
  }

  // --- Monthly pay register (2-tab payroll workspace) ---
  @Get('finance/payroll/register')
  @Roles(...READ)
  payrollRegister(@CurrentTenant('tenantId') t: string) {
    return this.service.listPayrollRegister(t);
  }

  @Get('finance/payroll/shortage-rates')
  @Roles(...READ)
  shortageRates(@CurrentTenant('tenantId') t: string) {
    return this.service.getShortageRates(t);
  }

  @Put('finance/payroll/shortage-rates')
  @Roles(...WRITE)
  setShortageRates(@CurrentTenant('tenantId') t: string, @Body() dto: SetShortageRatesDto) {
    return this.service.setShortageRates(t, dto);
  }

  @Put('finance/payroll/salary')
  @Roles(...WRITE)
  setSalary(@CurrentTenant('tenantId') t: string, @Body() dto: SetSalaryOverrideDto) {
    return this.service.setSalaryOverride(t, dto);
  }

  @Post('finance/payroll/pay')
  @Roles(...APPROVER)
  paySalary(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Body() dto: PaySalaryDto) {
    return this.service.paySalary(t, u, dto);
  }

  @Get('finance/payroll/staff-options')
  @Roles('ACCOUNTANT', 'TEACHER', 'ACADEMIC_AFFAIRS')
  staffOptions(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string) {
    return this.service.listPayrollStaffOptions(t, u);
  }

  @Post('finance/payroll/assign-salary')
  @Roles(...WRITE)
  assignStaffSalary(@CurrentTenant('tenantId') t: string, @Body() dto: AssignStaffSalaryDto) {
    return this.service.assignStaffSalary(t, dto);
  }

  @Post('finance/payroll/positions')
  @Roles(...WRITE)
  upsertPositionSalary(@CurrentTenant('tenantId') t: string, @Body() dto: UpsertPositionSalaryDto) {
    return this.service.upsertPositionSalary(t, dto);
  }
}

@ApiTags('Finance Family Condition')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PermissionsGuard)
@RequirePermission(PERMISSIONS.FAMILY_CONDITION_VIEW)
@ApiSecurity('X-Tenant-Id')
@Controller()
@Roles('ACCOUNTANT')
export class FinanceFamilyController {
  constructor(private service: FinancePayrollService) {}

  private canViewReason(req: any): boolean {
    const roles = req.tenant?.roles || req.user?.roles || [];
    return hasPermission(roles, PERMISSIONS.FAMILY_CONDITION_VIEW);
  }

  @Get('finance/family-condition-discounts')
  familyConditions(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Req() req: any) {
    const canView = this.canViewReason(req);
    if (canView) {
      void this.service.recordFamilyConditionView(t, u);
    }
    return this.service.listFamilyConditions(t, canView);
  }

  @Post('finance/family-condition-discounts')
  @RequirePermission(PERMISSIONS.FAMILY_CONDITION_MANAGE)
  create(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Body() dto: CreateFamilyConditionDto) {
    return this.service.createFamilyCondition(t, u, dto);
  }

  @Post('finance/family-condition-discounts/:id/approve')
  @RequirePermission(PERMISSIONS.FAMILY_CONDITION_MANAGE)
  approve(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.approveFamilyCondition(t, u, id);
  }

  @Post('finance/family-condition-discounts/:id/reject')
  @RequirePermission(PERMISSIONS.FAMILY_CONDITION_MANAGE)
  reject(@CurrentTenant('tenantId') t: string, @CurrentUser('userId') u: string, @Param('id') id: string) {
    return this.service.rejectFamilyCondition(t, u, id);
  }
}
