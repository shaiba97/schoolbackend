import { IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNotificationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty()
  @IsString()
  message: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  recipientStudentIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(['STUDENT', 'CLASS', 'GRADE', 'EDUCATION_LEVEL', 'SCHOOL_WIDE'])
  targetType?: 'STUDENT' | 'CLASS' | 'GRADE' | 'EDUCATION_LEVEL' | 'SCHOOL_WIDE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetId?: string;
}
