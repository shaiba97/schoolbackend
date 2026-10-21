import { ApiPropertyOptional } from '@nestjs/swagger';
import { AnnouncementSeverity } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateAnnouncementDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  body?: string;

  @ApiPropertyOptional({ enum: AnnouncementSeverity })
  @IsOptional()
  @IsEnum(AnnouncementSeverity)
  severity?: AnnouncementSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
