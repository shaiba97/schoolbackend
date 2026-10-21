import { IsArray, IsDateString, IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const EXAM_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'ONGOING',
  'MARKS_OPEN',
  'MODERATION',
  'COMPLETED',
  'PROCESSED',
  'PUBLISHED',
  'CLOSED',
] as const;

export class CreateExamSubjectDto {
  @ApiProperty()
  @IsUUID()
  classSubjectId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  examDate?: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  maxMarks: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  passingMarks?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gradingScaleId?: string;
}

export class ExamSampleDto {
  @ApiProperty({ description: 'Staged object key from POST /storage/upload with documentType EXAM_SAMPLE' })
  @IsString()
  objectKey: string;

  @ApiProperty()
  @IsString()
  originalName: string;

  @ApiProperty()
  @IsNumber()
  size: number;
}

export class CreateExamDto {
  @ApiProperty()
  @IsUUID()
  academicYearId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  termId?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  examTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsOn?: string;

  @ApiPropertyOptional({ type: [CreateExamSubjectDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateExamSubjectDto)
  subjects?: CreateExamSubjectDto[];

  @ApiPropertyOptional({
    description: 'Apply the exam to these classes: one Exam row per class sharing an examGroupId. Omit for a single standalone exam.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  classIds?: string[];

  @ApiPropertyOptional({ description: 'Reference sample paper (staged upload)' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ExamSampleDto)
  sample?: ExamSampleDto;
}

export class UpdateExamDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  examTypeId?: string;

  @ApiPropertyOptional({ enum: EXAM_STATUSES })
  @IsOptional()
  @IsIn([...EXAM_STATUSES])
  status?: string;

  @ApiPropertyOptional({ description: 'Replace the sample paper, or null to remove it' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ExamSampleDto)
  sample?: ExamSampleDto | null;
}

export class EnterMarksDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiProperty()
  marks: number;

  @ApiPropertyOptional()
  @IsOptional()
  remarks?: string;
}

export class BulkEnterMarksDto {
  @ApiProperty({ type: [EnterMarksDto] })
  @IsArray()
  records: EnterMarksDto[];
}

export class CreateRoomAssignmentDto {
  @ApiProperty()
  @IsUUID()
  hallId: string;

  @ApiPropertyOptional({
    description: 'Invigilating teachers. Omit or empty for none.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  invigilatorIds?: string[];

  @ApiPropertyOptional({
    description: 'Seated students in explicit order (seatOrder follows array order). Omit to auto-fill from the exam classes sorted by name.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  studentIds?: string[];
}

export class UpdateRoomAssignmentDto {
  @ApiProperty({ description: 'Replacement set of invigilating teachers', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  invigilatorIds: string[];
}

export class SeatOrderDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  seatOrder: number;
}

export class ReorderRoomStudentsDto {
  @ApiProperty({ type: [SeatOrderDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeatOrderDto)
  orders: SeatOrderDto[];
}
