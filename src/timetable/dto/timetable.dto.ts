import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const TIMETABLE_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
export const TIMETABLE_TYPE_VALUES = ['REGULAR', 'REVISION', 'TEST', 'EXAMINATION'] as const;

export class TimetableQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  termId?: string;

  @ApiPropertyOptional({ enum: TIMETABLE_TYPE_VALUES })
  @IsOptional()
  @IsIn(TIMETABLE_TYPE_VALUES)
  timetableType?: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  examName?: string;
}

/**
 * One cell of the interactive week grid. A break cell carries only its times;
 * an academic cell carries a subject and the teacher who teaches it here.
 */
export class TimetableCellDto {
  @ApiProperty({ enum: TIMETABLE_DAYS })
  @IsEnum(TIMETABLE_DAYS)
  day: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(20)
  periodNo: number;

  @ApiProperty()
  @IsBoolean()
  isBreak: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiProperty({ example: '08:00' })
  @IsString()
  @MaxLength(5)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime: string;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @MaxLength(5)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime: string;
}

/**
 * The payload is the complete set of populated cells for one class; the server
 * upserts by (class, type, exam, day, period) and removes anything it no longer sees. That
 * is what makes "Save Timetable" a single request instead of one per cell.
 */
export class BatchTimetableDto {
  @ApiPropertyOptional({ format: 'uuid', description: "Defaults to the tenant's current academic year." })
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  termId?: string;

  /** Which stored week this save targets: one class holds one week per type. */
  @ApiProperty({ enum: TIMETABLE_TYPE_VALUES })
  @IsIn(TIMETABLE_TYPE_VALUES)
  timetableType: string;

  /** Required for EXAMINATION weeks so one class can hold several exam weeks. */
  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  examName?: string;

  /** Periods per day selected in the UI; every school day must hold at least this many lessons. */
  @ApiProperty({ minimum: 1, maximum: 9 })
  @IsInt()
  @Min(1)
  @Max(9)
  periodsPerDay: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  classId: string;

  @ApiProperty({ type: [TimetableCellDto] })
  @IsArray()
  @Type(() => TimetableCellDto)
  @ValidateNested({ each: true })
  cells: TimetableCellDto[];
}

