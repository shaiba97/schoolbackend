import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { MARKETS } from '../platform-markets';

const MARKET_CODES = MARKETS.map((market) => market.code);

/**
 * The school a super admin provisions.
 *
 * There is no slug in this contract: the platform derives one from the
 * school name, because a slug is a URL detail, not something an operator
 * should have to invent. The market decides the currency and the timezone,
 * so a school can never end up billing in a currency that does not match
 * the country it is in.
 */
export class ProvisionTenantDto {
  @ApiProperty({ example: 'Springfield Academy' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    description: 'The school name in Arabic, for schools that trade in both',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string;

  @ApiProperty({ enum: MARKET_CODES })
  @IsEnum(MARKET_CODES)
  countryCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiProperty({ description: 'Full name of the first school administrator' })
  @IsString()
  @MinLength(3)
  adminName!: string;

  @ApiProperty()
  @IsEmail()
  adminEmail!: string;

  @ApiPropertyOptional({ description: 'Administrator phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  adminPhone?: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  adminPassword!: string;

  @ApiPropertyOptional({
    description: 'Plan code to issue the first license for',
  })
  @IsOptional()
  @IsString()
  planCode?: string;

  @ApiPropertyOptional({
    description:
      'Students the licence covers. The plan price is per student per month, so this number sets the monthly amount.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  studentCount?: number;
}
