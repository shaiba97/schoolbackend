import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMembershipDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roleSlug?: string;
}

export class UpdateMembershipDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  roleSlug?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'INVITED'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE', 'INVITED'] as const)
  status?: 'ACTIVE' | 'INACTIVE' | 'INVITED';
}
