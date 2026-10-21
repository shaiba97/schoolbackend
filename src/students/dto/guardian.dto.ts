import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STUDENT_STATUS_VALUES } from './student.dto';

export class CreateGuardianDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiPropertyOptional({
    description: 'Auto-designed guardian number (YYCPGNNNN); omit to auto-assign, or pass an explicit one for backfill',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  guardianNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateGuardianDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;
}

export class LinkGuardianDto {
  @ApiProperty()
  @IsUUID()
  guardianId: string;

  @ApiProperty()
  @IsString()
  @MaxLength(50)
  relationship: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canPickup?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emergencyContact?: boolean;
}

export class CreateStudentGuardianDto extends CreateGuardianDto {
  @ApiProperty({ description: 'Relationship to the student: FATHER | MOTHER | OTHER' })
  @IsString()
  @MaxLength(50)
  relationship: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canPickup?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emergencyContact?: boolean;
}

export class UpdateStudentGuardianDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  relationship?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  canPickup?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emergencyContact?: boolean;
}

export const STUDENT_STATUSES = STUDENT_STATUS_VALUES;

export class UpdateStudentStatusDto {
  @ApiProperty({ enum: STUDENT_STATUSES })
  @IsIn([...STUDENT_STATUSES])
  status: string;

  @ApiPropertyOptional({ description: 'Required when status is POSTPONED or FIRED; recorded on the student file' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
