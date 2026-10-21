import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateStudentDto } from './student.dto';
import { CreateGuardianDto } from './guardian.dto';
import { EnrollStudentDto } from './enrollment.dto';
import {
  STUDENT_DOCUMENT_TYPES,
  type StudentDocumentType,
} from '../../storage/dto/upload-file.dto';

export const ADMISSION_RELATIONSHIP_VALUES = [
  'FATHER',
  'MOTHER',
  'BROTHER',
  'SISTER',
  'GUARDIAN',
] as const;

export class AdmissionStudentDto extends CreateStudentDto {}

export class AdmissionGuardianDto extends CreateGuardianDto {
  @ApiPropertyOptional({
    description: 'Link an existing guardian instead of creating one; name/password creation fields are skipped then',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  guardianId?: string;

  @ApiPropertyOptional({ description: 'Required when creating a guardian; ignored when guardianId links an existing one' })
  @ValidateIf((o) => !o.guardianId)
  @IsString()
  @MaxLength(100)
  firstName: string = undefined as unknown as string;

  @ApiPropertyOptional({ description: 'Required when creating a guardian; ignored when guardianId links an existing one' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @ValidateIf((o) => !o.guardianId)
  password: string;

  @ApiProperty({ enum: ADMISSION_RELATIONSHIP_VALUES })
  @IsIn(ADMISSION_RELATIONSHIP_VALUES)
  relationship: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  canPickup?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  emergencyContact?: boolean;
}

export class AdmissionEnrollmentDto extends EnrollStudentDto {}

export class AdmissionDocumentDto {
  @ApiProperty({ enum: STUDENT_DOCUMENT_TYPES })
  @IsIn(STUDENT_DOCUMENT_TYPES)
  documentType: StudentDocumentType;

  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  objectKey: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  originalName: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  contentType: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024)
  size: number;
}

export class CreateAdmissionDto {
  @ApiProperty()
  @IsUUID()
  draftId: string;

  @ApiProperty({ type: AdmissionStudentDto })
  @ValidateNested()
  @Type(() => AdmissionStudentDto)
  student: AdmissionStudentDto;

  @ApiProperty({ type: AdmissionGuardianDto })
  @ValidateNested()
  @Type(() => AdmissionGuardianDto)
  guardian: AdmissionGuardianDto;

  @ApiProperty({ type: AdmissionEnrollmentDto })
  @ValidateNested()
  @Type(() => AdmissionEnrollmentDto)
  enrollment: AdmissionEnrollmentDto;

  @ApiProperty({ type: [AdmissionDocumentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AdmissionDocumentDto)
  documents: AdmissionDocumentDto[];
}
