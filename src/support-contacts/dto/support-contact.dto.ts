import { IsEnum, IsNotEmpty, IsOptional, IsString, IsBoolean, Length } from 'class-validator';
import { ContactType, InquiryRegion } from '@prisma/client';

export class CreateSupportContactDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  contact!: string;

  @IsEnum(ContactType)
  contactType!: ContactType;

  @IsEnum(InquiryRegion)
  region!: InquiryRegion;
}

export class UpdateSupportContactDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  contact!: string;

  @IsOptional()
  @IsEnum(ContactType)
  contactType!: ContactType;

  @IsOptional()
  @IsEnum(InquiryRegion)
  region!: InquiryRegion;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
