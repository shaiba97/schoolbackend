import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { InquiryStatus } from '@prisma/client';

export class ListInquiriesDto {
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class UpdateInquiryDto {
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  subject?: string | null;
}
