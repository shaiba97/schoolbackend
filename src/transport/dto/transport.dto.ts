import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export const BUS_STATUS_VALUES = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'] as const;
export const TRANSPORT_SHIFT_VALUES = ['MORNING', 'EVENING', 'BOTH'] as const;

export class CreateVehicleDto {
  @ApiProperty()
  @IsString()
  plateNumber: string;

  @ApiProperty()
  @IsString()
  model: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity: number;

  @ApiProperty()
  @IsString()
  driverName: string;

  @ApiProperty()
  @IsString()
  driverPhone: string;

  @ApiProperty()
  @IsString()
  driverLicenseNumber: string;

  @ApiProperty()
  @IsString()
  driverEmergencyContact: string;

  @ApiPropertyOptional({ enum: BUS_STATUS_VALUES, default: 'ACTIVE' })
  @IsOptional()
  @IsIn(BUS_STATUS_VALUES as readonly string[])
  status?: string;
}

export class UpdateVehicleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  plateNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverLicenseNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverEmergencyContact?: string;

  @ApiPropertyOptional({ enum: BUS_STATUS_VALUES })
  @IsOptional()
  @IsIn(BUS_STATUS_VALUES as readonly string[])
  status?: string;
}

export class CreateRouteDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: TRANSPORT_SHIFT_VALUES })
  @IsIn(TRANSPORT_SHIFT_VALUES as readonly string[])
  shift: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  busId?: string | null;
}

export class UpdateRouteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: TRANSPORT_SHIFT_VALUES })
  @IsOptional()
  @IsIn(TRANSPORT_SHIFT_VALUES as readonly string[])
  shift?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  busId?: string | null;
}

export class StopDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequence: number;

  @ApiPropertyOptional({ description: 'HH:MM 24h morning pickup ETA' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'morningEta must be HH:MM (24h)',
  })
  morningEta?: string;

  @ApiPropertyOptional({ description: 'HH:MM 24h evening drop-off ETA' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'eveningEta must be HH:MM (24h)',
  })
  eveningEta?: string;
}

export class ReplaceStopsDto {
  @ApiProperty({ type: [StopDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StopDto)
  stops: StopDto[];
}

export class AssignStudentDto {
  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiProperty()
  @IsUUID()
  routeId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  stopId?: string;

  @ApiPropertyOptional({
    description:
      'Annual transport fee; omitted leaves the current finance amount',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  transportFee?: number;
}

export class ArriveStopDto {
  @ApiProperty()
  @IsUUID()
  stopId: string;
}

export class TransportListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Manifest only: filter by route' })
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({
    description: 'Manifest only: filter assignments to the routes of one bus',
  })
  @IsOptional()
  @IsUUID()
  busId?: string;
}

export class AssignStudentsBatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  studentIds: string[];

  @ApiProperty()
  @IsUUID()
  routeId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  stopId?: string;

  @ApiPropertyOptional({
    description:
      'Annual transport fee applied to every assigned student; omitted leaves the current finance amount',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  transportFee?: number;
}
