import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MarkAttendanceDto } from '../../attendance/dto/attendance.dto';

export class TeacherMeDateQueryDto {
  @ApiProperty({ example: '2026-10-02' })
  @IsDateString()
  date: string;
}

export class CreateTeacherSessionDto {
  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiProperty({
    description:
      'Timetable period number. The session is stored with sessionNumber = periodNo, so each period of the day holds an individual session.',
    minimum: 1,
    maximum: 20,
  })
  @IsInt()
  @Min(1)
  @Max(20)
  periodNo: number;

  @ApiPropertyOptional({
    description:
      'Accepted but ignored: the subject is always derived server-side from the timetable entry for class + day + period.',
  })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiProperty({ example: '2026-10-02' })
  @IsDateString()
  date: string;
}

export class TeacherMarkBulkDto {
  @ApiProperty({ type: [MarkAttendanceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MarkAttendanceDto)
  records: MarkAttendanceDto[];
}

export class TeacherExamsQueryDto {
  @ApiPropertyOptional({ enum: ['authored', 'assigned', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['authored', 'assigned', 'all'])
  scope?: 'authored' | 'assigned' | 'all';
}

export class TeacherStudentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;

  @ApiPropertyOptional({ description: 'Optional filter; must be a class this teacher teaches' })
  @IsOptional()
  @IsUUID()
  classId?: string;
}

export class CreateTeacherAnnouncementDto {
  @ApiProperty({ description: 'Class this announcement is scoped to; must be one the teacher teaches' })
  @IsUUID()
  classId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message: string;
}

export class TeacherDashboardQueryDto {
  @ApiPropertyOptional({ description: 'Academic year override; defaults to the current year' })
  @IsOptional()
  @IsUUID()
  yearId?: string;
}

export class TeacherMarksEntryDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  /** Null for ABSENT/PERMITTED entries — those carry a remark instead of a score. */
  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @IsNumber()
  @Min(0)
  marks?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  remarks?: string;
}

export class TeacherBulkMarksDto {
  @ApiProperty({ type: [TeacherMarksEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TeacherMarksEntryDto)
  records: TeacherMarksEntryDto[];
}

export class ReturnSubjectMarksDto {
  @ApiProperty({ description: 'Why the marks are being sent back to draft' })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}
