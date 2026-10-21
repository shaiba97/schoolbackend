import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const RECEPTIONIST_ATTENDANCE_TYPES = [
  'staff',
  'teacher',
  'student',
] as const;
export type ReceptionistAttendanceType =
  (typeof RECEPTIONIST_ATTENDANCE_TYPES)[number];

export const RECEPTIONIST_ATTENDANCE_STATUSES = [
  'PRESENT',
  'LATE',
  'ABSENT',
  'PERMITTED',
] as const;
export type ReceptionistAttendanceStatus =
  (typeof RECEPTIONIST_ATTENDANCE_STATUSES)[number];

export class ReceptionistAttendanceQueryDto {
  @ApiProperty({ enum: RECEPTIONIST_ATTENDANCE_TYPES })
  @IsIn([...RECEPTIONIST_ATTENDANCE_TYPES])
  type: ReceptionistAttendanceType;

  @ApiPropertyOptional({ example: '2026-10-18' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class MarkAttendanceEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  entityId: string;

  @ApiProperty({ enum: RECEPTIONIST_ATTENDANCE_STATUSES })
  @IsIn([...RECEPTIONIST_ATTENDANCE_STATUSES])
  status: ReceptionistAttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class MarkAttendanceDto {
  @ApiProperty({ enum: RECEPTIONIST_ATTENDANCE_TYPES })
  @IsIn([...RECEPTIONIST_ATTENDANCE_TYPES])
  entityType: ReceptionistAttendanceType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  entityId: string;

  @ApiProperty({ enum: RECEPTIONIST_ATTENDANCE_STATUSES })
  @IsIn([...RECEPTIONIST_ATTENDANCE_STATUSES])
  status: ReceptionistAttendanceStatus;

  @ApiProperty({ example: '2026-10-18' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class ReceptionistProfileResponseDto {
  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string | null;

  @ApiProperty()
  staffNumber: string | null;

  @ApiProperty()
  phone: string | null;

  @ApiProperty()
  email: string | null;

  @ApiProperty()
  role: 'RECEPTIONIST';

  @ApiPropertyOptional()
  department?: string;
}

export class AttendanceRowDto {
  @ApiProperty({ format: 'uuid' })
  entityId: string;

  @ApiProperty()
  fullName: string;

  @ApiProperty()
  idLabel: string | null;

  @ApiProperty()
  contextLabel: string;

  @ApiPropertyOptional()
  status: ReceptionistAttendanceStatus | 'EXCUSED' | 'LEAVE' | null;
}

export class AttendanceListResponseDto {
  @ApiProperty({ type: [AttendanceRowDto] })
  rows: AttendanceRowDto[];
}

export class MarkAttendanceResponseDto {
  @ApiProperty({ format: 'uuid' })
  entityId: string;

  @ApiProperty({ enum: RECEPTIONIST_ATTENDANCE_TYPES })
  entityType: ReceptionistAttendanceType;

  @ApiProperty()
  status: string;

  @ApiProperty({ example: '2026-10-18' })
  date: string;
}

export class SocketTicketResponseDto {
  @ApiProperty()
  ticket: string;

  @ApiProperty()
  expiresIn: number;
}
