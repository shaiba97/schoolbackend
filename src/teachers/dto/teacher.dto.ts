import { Gender, TeacherDocumentSource, TeacherStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const TEACHER_DOCUMENT_TYPES = ['PROFILE_IMAGE', 'ID_PROOF'] as const;

export type TeacherDocumentType = (typeof TEACHER_DOCUMENT_TYPES)[number];

export class UploadedTeacherDocumentDto {
  @ApiProperty({ enum: TEACHER_DOCUMENT_TYPES })
  @IsIn(TEACHER_DOCUMENT_TYPES)
  documentType: TeacherDocumentType;

  @ApiProperty()
  @IsString()
  @MaxLength(1024)
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
  @IsInt()
  @Min(1)
  size: number;
}

export class CreateTeacherDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiProperty({ description: 'Sudanese mobile — the teacher\'s contact number and sign-in id' })
  @IsString()
  @Matches(/^(?:\+249|0)?9\d{8}$/, {
    message: 'phone must be a Sudanese mobile number, e.g. +249 91 234 5678',
  })
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  employeeNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ type: [UploadedTeacherDocumentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UploadedTeacherDocumentDto)
  documents?: UploadedTeacherDocumentDto[];
}

export class UpdateTeacherDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ description: 'Sudanese mobile; unique within the school' })
  @IsOptional()
  @IsString()
  @Matches(/^(?:\+249|0)?9\d{8}$/, {
    message: 'phone must be a Sudanese mobile number, e.g. +249 91 234 5678',
  })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  employeeNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ type: [UploadedTeacherDocumentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UploadedTeacherDocumentDto)
  documents?: UploadedTeacherDocumentDto[];

  @ApiPropertyOptional({ enum: TeacherStatus })
  @IsOptional()
  @IsEnum(TeacherStatus)
  status?: TeacherStatus;
}

export class UpdateTeacherStatusDto {
  @ApiProperty({ enum: TeacherStatus })
  @IsEnum(TeacherStatus)
  status: TeacherStatus;
}

export class CreateTeacherCredentialDto {
  @ApiProperty({ description: 'Display name, unique per teacher', maxLength: 150 })
  @IsString()
  @Matches(/\S/, { message: 'title must not be blank' })
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional({
    enum: TeacherDocumentSource,
    default: TeacherDocumentSource.ACADEMIC_AFFAIRS,
  })
  @IsOptional()
  @IsEnum(TeacherDocumentSource)
  source?: TeacherDocumentSource;

  @ApiProperty({ description: 'Staged upload object key' })
  @IsString()
  @MaxLength(1024)
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
  @IsInt()
  @Min(1)
  size: number;
}

export class UpdateTeacherCredentialDto {
  @ApiPropertyOptional({ description: 'Display name, unique per teacher', maxLength: 150 })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'title must not be blank' })
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ enum: TeacherDocumentSource })
  @IsOptional()
  @IsEnum(TeacherDocumentSource)
  source?: TeacherDocumentSource;

  @ApiPropertyOptional({ description: 'Replacement staged upload object key' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  objectKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contentType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  size?: number;
}

export class TeacherQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999)
  limit: number = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: TeacherStatus })
  @IsOptional()
  @IsEnum(TeacherStatus)
  status?: TeacherStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}