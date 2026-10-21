import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PortalModule } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTierDto {
  @ApiProperty({ example: 'TIER-X' })
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,59}$/, {
    message:
      'A tier code may only contain uppercase letters, digits, hyphens, and underscores',
  })
  code!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ enum: ['PRIMARY', 'INTERMEDIATE', 'ADVANCED', 'CUSTOM'] })
  @IsEnum(['PRIMARY', 'INTERMEDIATE', 'ADVANCED', 'CUSTOM'])
  tier!: 'PRIMARY' | 'INTERMEDIATE' | 'ADVANCED' | 'CUSTOM';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  target?: string;

  @ApiProperty({
    enum: ['ANNUAL'],
    description:
      'A tier is always billed yearly. The term length is set by durationDays.',
  })
  @IsEnum(['ANNUAL'])
  billingModel!: 'ANNUAL';

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number | null;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ default: 365 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays!: number;

  @ApiPropertyOptional({ enum: PortalModule, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(PortalModule, { each: true })
  includedModules?: PortalModule[];

  @ApiPropertyOptional({ description: 'Feature entitlements, e.g. { "slaHours": 8 }' })
  @IsOptional()
  @IsObject()
  features?: Record<string, boolean | number | string>;
}

export class UpdateTierDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  target?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  durationDays?: number;

  @ApiPropertyOptional({ enum: PortalModule, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(PortalModule, { each: true })
  includedModules?: PortalModule[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  features?: Record<string, boolean | number | string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RenewSubscriptionDto {
  @ApiPropertyOptional({ description: 'Defaults to the tier term from today' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  licenseId?: string;

  @ApiPropertyOptional({
    description:
      'Students the licence covers after the renewal. The tier price is per student per month, so this sets the monthly amount.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  studentCount?: number;

  @ApiPropertyOptional({
    description:
      'Price per student per month for this licence. Overrides the tier price, which is what a quoted tier needs.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyPrice?: number;
}

export class UpgradeSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;

  @ApiPropertyOptional({
    description:
      'Price per student per month for this licence. Overrides the tier price, which is what a quoted tier needs.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyPrice?: number;
}
