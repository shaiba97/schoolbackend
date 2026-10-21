import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHallDto {
  @ApiProperty({ description: 'Hall name (unique per tenant)', maxLength: 150 })
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(150)
  name: string;

  @ApiProperty({ description: 'Seat capacity' })
  @IsInt()
  @Min(1)
  capacity: number;

  @ApiPropertyOptional({ description: 'Hall kind', enum: ['PHYSICAL', 'VIRTUAL'] })
  @IsOptional()
  @IsIn(['PHYSICAL', 'VIRTUAL'])
  type?: 'PHYSICAL' | 'VIRTUAL';
}

export class UpdateHallDto {
  @ApiPropertyOptional({ description: 'Hall name (unique per tenant)', maxLength: 150 })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ description: 'Seat capacity' })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional({ description: 'Hall kind', enum: ['PHYSICAL', 'VIRTUAL'] })
  @IsOptional()
  @IsIn(['PHYSICAL', 'VIRTUAL'])
  type?: 'PHYSICAL' | 'VIRTUAL';
}
