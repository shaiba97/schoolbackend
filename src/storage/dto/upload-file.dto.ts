import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const STUDENT_DOCUMENT_TYPES = [
  'PROFILE_IMAGE',
  'NATIONAL_NUMBER',
  'NATIONAL_CARD',
  'PASSPORT',
  'TRANSFER_RESULT',
  'GUARDIAN_ID_PROOF',
] as const;

export const STORAGE_DOCUMENT_TYPES = [
  ...STUDENT_DOCUMENT_TYPES,
  'ID_PROOF',
  'CREDENTIAL',
  'EXAM_SAMPLE',
] as const;

export type StudentDocumentType = (typeof STUDENT_DOCUMENT_TYPES)[number];

export class UploadFileDto {
  @ApiProperty()
  @IsUUID()
  draftId: string;

  @ApiProperty({ enum: STORAGE_DOCUMENT_TYPES })
  @IsIn(STORAGE_DOCUMENT_TYPES)
  documentType: StudentDocumentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fieldId?: string;
}

export class DeleteStagedFileDto {
  @ApiProperty()
  @IsString()
  objectKey: string;
}
