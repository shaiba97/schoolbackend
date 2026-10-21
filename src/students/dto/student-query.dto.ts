import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { EDUCATION_LEVEL_VALUES, STUDENT_STATUS_VALUES } from './student.dto';

export class StudentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: STUDENT_STATUS_VALUES })
  @IsOptional()
  @IsIn(STUDENT_STATUS_VALUES as readonly string[])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @ApiPropertyOptional({ enum: EDUCATION_LEVEL_VALUES })
  @IsOptional()
  @IsIn(EDUCATION_LEVEL_VALUES as readonly string[])
  educationLevel?: string;

  @ApiPropertyOptional({ description: 'Student grade number (1,2,3,6,7,8,9)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  grade?: number;
}
