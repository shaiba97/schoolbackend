import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGradingBandDto {
  @ApiProperty({ description: 'Inclusive lower bound, 0-100' })
  @IsNumber()
  @Min(0)
  @Max(100)
  minPercent: number;

  @ApiProperty({ description: 'Inclusive upper bound, 0-100, must be >= minPercent' })
  @IsNumber()
  @Min(0)
  @Max(100)
  maxPercent: number;

  @ApiProperty()
  @IsString()
  @Matches(/\S/, { message: 'grade must not be blank' })
  @MaxLength(10)
  grade: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  points?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  remark?: string;
}

export class CreateGradingScaleDto {
  @ApiProperty()
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty({ type: [CreateGradingBandDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGradingBandDto)
  bands: CreateGradingBandDto[];
}

export class UpdateGradingScaleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ type: [CreateGradingBandDto], description: 'Replaces all bands when provided' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGradingBandDto)
  bands?: CreateGradingBandDto[];
}
