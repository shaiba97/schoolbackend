import { ArrayNotEmpty, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSubjectDto {
  @ApiProperty()
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  departmentId: string;
}

export class UpdateSubjectDto {
  @ApiProperty()
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

/** One row of the repeatable "add another subject" list. */
export class SubjectItemDto {
  @ApiProperty()
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  departmentId: string;
}

/**
 * Creates several global subjects in one request. Attaching a subject to a
 * class is a separate, later step — see AssignSubjectsToClassesDto.
 */
export class BatchCreateSubjectsDto {
  @ApiProperty({ type: [SubjectItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  // @Type converts the plain rows so whitelist/forbidNonWhitelisted apply to
  // them; @ValidateNested is what actually runs each row's rules.
  @Type(() => SubjectItemDto)
  @ValidateNested({ each: true })
  items: SubjectItemDto[];
}

/** Attach an already-created subject to a set of classes. */
export class AssignSubjectsToClassesDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  classIds: string[];
}
