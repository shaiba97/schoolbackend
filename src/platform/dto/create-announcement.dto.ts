import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnnouncementSeverity } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAnnouncementDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  body!: string;

  @ApiProperty({ enum: AnnouncementSeverity, default: AnnouncementSeverity.INFO })
  @IsEnum(AnnouncementSeverity)
  severity!: AnnouncementSeverity;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  isActive?: boolean;
}
