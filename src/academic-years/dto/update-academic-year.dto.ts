import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAcademicYearDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsDateString()
  startsOn: string;

  @ApiProperty({ example: '2027-06-30' })
  @IsDateString()
  endsOn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}
