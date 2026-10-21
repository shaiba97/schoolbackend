import { IsDateString, IsInt, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAcademicTermDto {
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
