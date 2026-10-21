import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const EDUCATION_LEVEL_VALUES = ['SECONDARY', 'INTERMEDIATE'] as const;
export const SCHOOL_GRADE_VALUES = ['FIRST', 'SECOND', 'THIRD', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH'] as const;
export const CLASS_TRACK_VALUES = ['ART', 'SCIENCE'] as const;
export const CLASS_GENDER_VALUES = ['BOYS', 'GIRLS', 'MIXED'] as const;

export class CreateSchoolClassDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  className: string;

  @ApiProperty({ enum: EDUCATION_LEVEL_VALUES })
  @IsIn(EDUCATION_LEVEL_VALUES)
  educationLevel: string;

  @ApiProperty({ enum: SCHOOL_GRADE_VALUES })
  @IsIn(SCHOOL_GRADE_VALUES)
  grade: string;

  @ApiPropertyOptional({ enum: CLASS_TRACK_VALUES })
  @IsOptional()
  @IsIn(CLASS_TRACK_VALUES)
  track?: string;

  @ApiProperty({ enum: CLASS_GENDER_VALUES })
  @IsIn(CLASS_GENDER_VALUES)
  gender: string;

  /** Seats for the class as a whole. The UI requires it; the API validates the range when supplied. */
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class UpdateSchoolClassDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  className?: string;

  @ApiPropertyOptional({ enum: EDUCATION_LEVEL_VALUES })
  @IsOptional()
  @IsIn(EDUCATION_LEVEL_VALUES)
  educationLevel?: string;

  @ApiPropertyOptional({ enum: SCHOOL_GRADE_VALUES })
  @IsOptional()
  @IsIn(SCHOOL_GRADE_VALUES)
  grade?: string;

  @ApiPropertyOptional({ enum: CLASS_TRACK_VALUES })
  @IsOptional()
  @IsIn(CLASS_TRACK_VALUES)
  track?: string;

  @ApiPropertyOptional({ enum: CLASS_GENDER_VALUES })
  @IsOptional()
  @IsIn(CLASS_GENDER_VALUES)
  gender?: string;
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  /** Supervisor (head teacher) of the class. Null clears it. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classTeacherId?: string | null;
}
