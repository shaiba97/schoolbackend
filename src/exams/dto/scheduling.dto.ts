import { IsArray, IsDateString, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateSlotDto {
  @ApiProperty()
  @IsUUID()
  examSubjectId: string;

  @ApiProperty({ description: 'Session date (YYYY-MM-DD)' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Start time HH:mm' })
  @IsString()
  @Matches(TIME_RE, { message: 'startTime must be HH:mm' })
  startTime: string;

  @ApiProperty({ description: 'End time HH:mm' })
  @IsString()
  @Matches(TIME_RE, { message: 'endTime must be HH:mm' })
  endTime: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  hallId?: string;
}

export class UpdateSlotDto {
  @ApiPropertyOptional({ description: 'Session date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({ description: 'Start time HH:mm' })
  @IsOptional()
  @IsString()
  @Matches(TIME_RE, { message: 'startTime must be HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({ description: 'End time HH:mm' })
  @IsOptional()
  @IsString()
  @Matches(TIME_RE, { message: 'endTime must be HH:mm' })
  endTime?: string;

  @ApiPropertyOptional({ description: 'Hall id, or null to unassign' })
  @IsOptional()
  @IsUUID()
  hallId?: string | null;
}

export class SetSeatsDto {
  @ApiProperty()
  @IsUUID()
  hallId: string;

  @ApiProperty({ type: [String], description: 'Student ids seated in this hall (replaces the current set)' })
  @IsArray()
  @IsUUID(undefined, { each: true })
  studentIds: string[];
}

export class AssignDutyDto {
  @ApiProperty()
  @IsUUID()
  teacherId: string;

  @ApiProperty()
  @IsUUID()
  hallId: string;
}
