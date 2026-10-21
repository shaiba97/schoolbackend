import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const STUDENT_FIELD_VALUES = [
  'COMPUTER',
  'BIOLOGY',
  'ENGINEERING',
  'MILITARY_SCIENCES',
  'ISLAMIC_STUDIES',
] as const;

export class EnrollStudentDto {
  @ApiProperty()
  @IsUUID()
  academicYearId: string;

  @ApiProperty()
  @IsUUID()
  classId: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'COMPLETED', 'TRANSFERRED', 'WITHDRAWN'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'COMPLETED', 'TRANSFERRED', 'WITHDRAWN'] as const)
  status?: string;

  @ApiPropertyOptional({
    description: '2nd/3rd grade Secondary field of study; required there, forbidden elsewhere',
    enum: STUDENT_FIELD_VALUES,
  })
  @IsOptional()
  @IsIn([...STUDENT_FIELD_VALUES])
  field?: string;
}

export class UpdateEnrollmentDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'COMPLETED', 'TRANSFERRED', 'WITHDRAWN'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'COMPLETED', 'TRANSFERRED', 'WITHDRAWN'] as const)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({ enum: STUDENT_FIELD_VALUES })
  @IsOptional()
  @IsIn([...STUDENT_FIELD_VALUES])
  field?: string | null;
}
