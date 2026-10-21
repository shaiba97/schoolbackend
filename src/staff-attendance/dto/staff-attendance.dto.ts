import { IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const STAFF_ATTENDANCE_STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'PERMITTED', 'LEAVE'] as const;

export class StaffAttendanceEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teacherId: string;

  @ApiProperty({ enum: STAFF_ATTENDANCE_STATUSES })
  @IsIn([...STAFF_ATTENDANCE_STATUSES])
  status: string;

  @ApiPropertyOptional({
    description: 'Departure time for mid-day leave (HH:MM). Only valid with PRESENT status.',
    example: '12:30',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'leftAt must be a valid time (HH:MM)' })
  leftAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class UpsertStaffAttendanceDto {
  @ApiProperty({ example: '2026-10-01' })
  @IsDateString()
  date: string;

  @ApiProperty({ type: [StaffAttendanceEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffAttendanceEntryDto)
  entries: StaffAttendanceEntryDto[];
}

export class StaffAttendanceQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiPropertyOptional({ description: 'Month filter (YYYY-MM)', example: '2026-10' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;
}

/** Non-teaching staff members (the /staff directory positions). */
export class StaffMemberAttendanceEntryDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the staff member' })
  @IsUUID()
  userId: string;

  @ApiProperty({ enum: STAFF_ATTENDANCE_STATUSES })
  @IsIn([...STAFF_ATTENDANCE_STATUSES])
  status: string;

  @ApiPropertyOptional({
    description: 'Departure time for mid-day leave (HH:MM). Only valid with PRESENT status.',
    example: '16:45',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'leftAt must be a valid time (HH:MM)' })
  leftAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class UpsertStaffMemberAttendanceDto {
  @ApiProperty({ example: '2026-10-01' })
  @IsDateString()
  date: string;

  @ApiProperty({ type: [StaffMemberAttendanceEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffMemberAttendanceEntryDto)
  entries: StaffMemberAttendanceEntryDto[];
}

export class StaffMemberAttendanceQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'User id of the staff member' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Month filter (YYYY-MM)', example: '2026-10' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;
}
