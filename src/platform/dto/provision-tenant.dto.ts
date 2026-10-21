import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PortalModule } from '@prisma/client';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ProvisionTenantDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'Defaults to a slug of the name' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/, {
    message: 'The slug may only contain lowercase letters, digits, and hyphens',
  })
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'SD' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @ApiPropertyOptional({ example: 'SDG' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currencyCode?: string;

  @ApiPropertyOptional({ example: 'Africa/Khartoum' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({ description: 'Full name of the first school administrator' })
  @IsString()
  @MinLength(3)
  adminName!: string;

  @ApiProperty()
  @IsEmail()
  adminEmail!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  adminPassword!: string;

  @ApiPropertyOptional({ description: 'Plan code to issue the first license for' })
  @IsOptional()
  @IsString()
  planCode?: string;

  @ApiPropertyOptional({
    enum: PortalModule,
    description: 'Portals to switch on. All portals are enabled when omitted.',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(PortalModule, { each: true })
  modules?: PortalModule[];

  @ApiPropertyOptional({ description: 'Feature flag overrides, e.g. { "notifications.whatsapp": true }' })
  @IsOptional()
  featureFlags?: Record<string, boolean>;
}
