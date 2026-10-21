import { Transform, Type } from 'class-transformer';
import {
  IsString, IsOptional, IsNotEmpty, IsNumber, IsEnum, IsDateString, IsBoolean,
  Min, Max, IsInt, IsArray, ArrayMinSize, ArrayMaxSize, MaxLength, IsIn,
} from 'class-validator';
import { MAX_INSTALLMENTS } from '../installment-math';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateFeeCategoryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateFeeCategoryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class FeeStructureShapeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tuitionFee: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  registrationFee?: number;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  educationLevel?: string;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INSTALLMENTS)
  installmentCount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INSTALLMENTS)
  @IsDateString({}, { each: true })
  installmentDueDates?: string[];
}

export class CreateFeeStructureDto extends FeeStructureShapeDto {}

export class UpdateFeeStructureDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tuitionFee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  registrationFee?: number;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  educationLevel?: string;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INSTALLMENTS)
  installmentCount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INSTALLMENTS)
  @IsDateString({}, { each: true })
  installmentDueDates?: string[];
}

export class CreatePaymentDto {
  @IsString()
  studentId: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  currencyCode: string;

  @IsString()
  method: string;

  @IsOptional()
  @IsString()
  reference?: string;
}

export class ReversePaymentDto {
  @IsString()
  reason: string;
}

export class CreateDiscountTypeDto {
  @IsString()
  name: string;

  @IsString()
  kind: string;
}

export class AssignDiscountDto {
  @IsString()
  studentId: string;

  @IsOptional()
  @IsString()
  discountTypeId?: string;

  @IsOptional()
  @IsIn(['SIBLING', 'TOPPER', 'MANUAL'])
  category?: string;

  @IsOptional()
  @IsIn(['PERCENTAGE', 'FIXED_AMOUNT'])
  valueType?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  name?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value: number;
}

export class CreateScholarshipDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class AssignScholarshipDto {
  @IsString()
  studentId: string;

  @IsString()
  scholarshipId: string;
}

export class CreateFamilyConditionDto {
  @IsString()
  studentId: string;

  @IsIn(['PERCENTAGE', 'FIXED_AMOUNT'])
  valueType: 'PERCENTAGE' | 'FIXED_AMOUNT';

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}

export class CreateSiblingRuleDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsIn(['SISTERS', 'BROTHERS', 'SISTERS_AND_BROTHERS'])
  relationType: 'SISTERS' | 'BROTHERS' | 'SISTERS_AND_BROTHERS';

  @Type(() => Number)
  @IsInt()
  @Min(2)
  minSiblingCount: number;

  @IsIn(['PERCENTAGE', 'FIXED_AMOUNT'])
  valueType: 'PERCENTAGE' | 'FIXED_AMOUNT';

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value: number;
}

export class PaySalaryDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsIn(['CASH', 'BANKAK', 'FAWRY', 'BANK_TRANSFER'])
  method: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SetShortageRatesDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  absentDaily?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lateRate?: number;
}

export class AssignStaffSalaryDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount: number;
}

export class UpsertPositionSalaryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  positionKey: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  baseSalary: number;
}

export class SetSalaryOverrideDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount: number;
}

export class CreateThresholdDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  module: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  threshold: number;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  approverRole: string;
}

export class UpdateThresholdDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  module?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  threshold?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  approverRole?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  accountName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountNumber?: string;
}

export class UpdateFinanceSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  receiptPrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  voucherPrefix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  graceDays?: number;
}

export class ApproveDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateExpenseCategoryDto {
  @IsString()
  name: string;
}

export class CreateExpenseDto {
  @IsString()
  categoryId: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  currency: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  vendor?: string;
}

export class CreateRefundDto {
  @IsString()
  paymentId: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  reason: string;
}

export class CreateAccountDto {
  @IsString()
  name: string;

  @IsEnum(['CASH', 'BANK'])
  type: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNo?: string;

  @IsString()
  currency: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  openingBalance?: number;
}

export class RecordTransactionDto {
  @IsString()
  accountId: string;

  @IsEnum(['DEBIT', 'CREDIT'])
  type: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;
}

export class DailyClosingDto {
  @IsString()
  accountId: string;

  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0)
  countedAmount: number;
}

export class BankReconciliationDto {
  @IsString()
  accountId: string;

  @IsDateString()
  statementDate: string;

  @IsNumber()
  statementBalance: number;

  @IsNumber()
  bookBalance: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreatePeriodDto {
  @IsString()
  name: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}

export class CreatePaymentMethodDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
