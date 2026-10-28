import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import {
  FinanceCategoriesService, FinancePaymentsService,
  FinanceDiscountsService, FinanceExpensesService,
  FinanceCashService, FinanceControlsService, FinanceDashboardService,
} from './finance.service';
import { FinancePortalService } from './finance-portal.service';
import { FinancePayrollService } from './finance-payroll.service';
import { FinanceReportsService } from './finance-reports.service';
import { FinancePayrollController, FinanceFamilyController } from './finance-payroll.controller';
import { FinanceReportsController } from './finance-reports.controller';
import {
  FinanceCategoriesController, FinancePaymentsController,
  FinanceDiscountsController, FinanceExpensesController,
  FinanceRefundsController, FinanceCashController, FinanceControlsController,
  FinanceDashboardController,
} from './finance.controller';
import { FinancePortalController } from './finance-portal.controller';

@Module({
  imports: [PrismaModule, RealtimeModule, AuthModule],
  controllers: [
    FinanceCategoriesController,
    FinancePaymentsController,
    FinanceDiscountsController,
    FinanceExpensesController,
    FinanceRefundsController,
    FinanceCashController,
    FinanceControlsController,
    FinanceDashboardController,
    FinancePortalController,
    FinancePayrollController,
    FinanceFamilyController,
    FinanceReportsController,
  ],
  providers: [
    FinanceCategoriesService,
    FinancePaymentsService,
    FinanceDiscountsService,
    FinanceExpensesService,
    FinanceCashService,
    FinanceControlsService,
    FinanceDashboardService,
    FinancePortalService,
    FinancePayrollService,
    FinanceReportsService,
  ],
  // TransportModule consumes FinancePortalService (setStudentTransportFee /
  // getTransportFeeStatus) at the service level — finance HTTP routes keep
  // their ACCOUNTANT-portal RolesGuard regardless. Students/teachers/parents
  // me-services reuse the same two finance brains for self-service ledger
  // and payroll reads; they never receive finance HTTP routes at all.
  exports: [FinancePortalService, FinancePayrollService],
})
export class FinanceModule {}
