import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class UpdateCurrencyDto {
  @ApiProperty({ description: 'Units of this currency per 1 USD' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  rateToUsd!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoSync?: boolean;
}

export class LogExpenseDto {
  @ApiProperty()
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiProperty({
    enum: ['INFRASTRUCTURE', 'MARKETING', 'LEGAL', 'SUPPORT', 'OTHER'],
  })
  @IsString()
  category!: 'INFRASTRUCTURE' | 'MARKETING' | 'LEGAL' | 'SUPPORT' | 'OTHER';

  @ApiPropertyOptional({ description: 'Omit or null for a global allocation' })
  @IsOptional()
  @IsString()
  countryCode?: string | null;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  paidAt!: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 400)
  notes?: string;
}
