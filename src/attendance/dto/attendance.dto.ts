import { IsArray, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttendanceMatrixQueryDto {
  @ApiProperty({ example: '2026-10-12' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-10-16' })
  @IsDateString()
  to: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
}

export class CreateAttendanceSessionDto {
  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiProperty({ example: '2026-09-20' })
  @IsDateString()
  date: string;
}

export class MarkAttendanceDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiProperty({ enum: ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] })
  @IsString()
  status: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class BulkMarkAttendanceDto {
  @ApiProperty({ type: [MarkAttendanceDto] })
  @IsArray()
  records: MarkAttendanceDto[];
}
