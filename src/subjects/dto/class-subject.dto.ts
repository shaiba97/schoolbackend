import { IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClassSubjectDto {
  @ApiProperty()
  @IsUUID()
  subjectId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacherId?: string;
}

export class UpdateClassSubjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacherId?: string;
}
