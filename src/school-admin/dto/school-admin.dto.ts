import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PortalModule } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateSchoolAdminProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class UpdateSchoolTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'The school name in Arabic' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  websiteUrl?: string | null;

  @ApiPropertyOptional({ example: 'SD' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string | null;

  @ApiPropertyOptional({ example: 'SDG' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @ApiPropertyOptional({ example: 'Africa/Khartoum' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;
}

export class CreatePositionDto {
  @ApiProperty({ example: 'Head of Transport' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  title!: string;

  @ApiProperty({ enum: PortalModule })
  @IsEnum(PortalModule)
  portal!: PortalModule;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  description?: string;
}

export class RequestTierChangeDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  note?: string;
}
