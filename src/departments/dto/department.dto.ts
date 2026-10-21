import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDepartmentDto {
  @ApiProperty({ description: 'Department name (unique per tenant)', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional({ description: 'Department name (unique per tenant)', maxLength: 150 })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;
}
