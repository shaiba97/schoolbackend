import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class RecordPaymentDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  licenseId?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'SAR' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({
    enum: ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'BANK_API'],
  })
  @IsEnum(['BANK_TRANSFER', 'CHEQUE', 'CASH', 'BANK_API'])
  method!: 'BANK_TRANSFER' | 'CHEQUE' | 'CASH' | 'BANK_API';

  @ApiPropertyOptional({
    enum: ['MANUAL_TRANSFER', 'CASH_DEPOSIT', 'BANK_API_PENDING'],
    default: 'MANUAL_TRANSFER',
  })
  @IsOptional()
  @IsEnum(['MANUAL_TRANSFER', 'CASH_DEPOSIT', 'BANK_API_PENDING'])
  type?: 'MANUAL_TRANSFER' | 'CASH_DEPOSIT' | 'BANK_API_PENDING';

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  paidAt!: Date;

  @ApiPropertyOptional({ description: 'Bank reference or deposit slip id' })
  @IsOptional()
  @IsString()
  @Length(0, 80)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 400)
  notes?: string;
}

export class IssueReceiptDto {
  @ApiProperty()
  @IsUUID()
  tenantId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  licenseId?: string;

  @ApiPropertyOptional({
    description:
      'The amount on the document. Left out, the server prices the receipt from the term the school bought.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: 'Defaults to the tier currency' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
