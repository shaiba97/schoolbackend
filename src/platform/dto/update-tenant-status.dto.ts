import { ApiProperty } from '@nestjs/swagger';
import { TenantStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateTenantStatusDto {
  @ApiProperty({ enum: TenantStatus })
  @IsEnum(TenantStatus)
  status!: TenantStatus;
}
