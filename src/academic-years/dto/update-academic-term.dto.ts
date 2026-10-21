import { IsDateString, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAcademicTermDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsDateString()
  startsOn: string;

  @ApiProperty({ example: '2026-12-20' })
  @IsDateString()
  endsOn: string;

  @ApiProperty()
  @IsInt()
  sequenceNo: number;
}
