import { IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExamTypeDto {
  @ApiProperty({ description: 'Exam type name (unique per tenant)', maxLength: 150 })
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ description: 'Default weight applied to new exams of this type' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultWeight?: number;
}

export class UpdateExamTypeDto {
  @ApiPropertyOptional({ description: 'Exam type name (unique per tenant)', maxLength: 150 })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ description: 'Default weight applied to new exams of this type' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultWeight?: number;
}
