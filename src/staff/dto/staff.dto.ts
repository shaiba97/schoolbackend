import { PortalModule } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const STAFF_POSITIONS = [
  'FINANCIAL_AFFAIRS',
  'ACADEMIC_AFFAIRS',
  'RECEPTIONIST',
  'TRANSPORT_COORDINATOR',
  'PRINCIPAL',
  'JANITOR',
  'LIBRARIAN',
  'CUSTOM',
] as const;

export class CreateStaffDto {
  @IsString()
  @MinLength(1)
  fullName: string;

  @IsString()
  @MinLength(8)
  phone: string;

  @IsOptional()
  @IsIn([...STAFF_POSITIONS])
  position?: string;

  @IsOptional()
  @IsString()
  customPositionTitle?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  /**
   * The portal a CUSTOM position belongs to. The other positions name their
   * own portal, so this only applies to a custom title.
   */
  @IsOptional()
  @IsIn(Object.values(PortalModule))
  portal?: PortalModule;

  /**
   * Deprecated: legacy callers send a system `role` slug instead of `position`.
   * Mapped to the matching position server-side. Remove once all clients send `position`.
   */
  @IsOptional()
  @IsIn(['RECEPTIONIST', 'ACADEMIC_ADMIN', 'ACCOUNTANT'])
  role?: string;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  phone?: string;

  @IsOptional()
  @IsIn([...STAFF_POSITIONS])
  position?: string;

  @IsOptional()
  @IsString()
  customPositionTitle?: string;

  /** Deprecated legacy slug — see CreateStaffDto.role. */
  @IsOptional()
  @IsIn(['RECEPTIONIST', 'ACADEMIC_ADMIN', 'ACCOUNTANT'])
  role?: string;
}

export class ResetStaffPasswordDto {
  @IsString()
  @MinLength(8)
  password: string;
}

export class UpdateStaffStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status: string;
}

export class StaffQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([...STAFF_POSITIONS])
  role?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'SUSPENDED'])
  status?: string;
}

/** Self-service: the staff member edits only their own record. */
export class UpdateMeProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  phone?: string;
}

/** Self-service: the staff member changes only their own password. */
export class ChangeMyPasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
