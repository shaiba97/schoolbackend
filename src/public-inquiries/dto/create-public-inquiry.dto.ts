import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
} from 'class-validator';

// The regions a prospect school can pick on the landing page's contact
// form. Each GCC state is its own value so intake knows exactly where a
// school operates; Sudan and Egypt round out the core market.
enum InquiryRegion {
  SUDAN = 'SUDAN',
  EGYPT = 'EGYPT',
  GCC_KSA = 'GCC_KSA',
  GCC_UAE = 'GCC_UAE',
  GCC_KUWAIT = 'GCC_KUWAIT',
  GCC_QATAR = 'GCC_QATAR',
  GCC_OMAN = 'GCC_OMAN',
  GCC_BAHRAIN = 'GCC_BAHRAIN',
}

export { InquiryRegion };

export class CreatePublicInquiryDto {
  @ApiProperty({ description: 'Prospect full name', minLength: 2, maxLength: 120 })
  @IsString()
  @Transform(({ value }) => String(value ?? '').trim())
  @Length(2, 120)
  fullName: string;

  @ApiProperty({ description: 'School or group name', minLength: 2, maxLength: 160 })
  @IsString()
  @Transform(({ value }) => String(value ?? '').trim())
  @Length(2, 160)
  schoolName: string;

  @ApiProperty({ description: 'Contact email address' })
  @IsEmail()
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  email: string;

  @ApiProperty({
    description: 'Phone or WhatsApp number, optionally with a leading country code',
  })
  @IsString()
  @Transform(({ value }) => String(value ?? '').trim())
  @Matches(/^\+?[0-9][0-9\s-]{6,29}$/, {
    message: 'phone must be digits, optionally starting with +, with spaces or dashes',
  })
  phone: string;

  @ApiProperty({ enum: InquiryRegion })
  @IsEnum(InquiryRegion)
  region: InquiryRegion;

  @ApiProperty({ description: 'Request details', minLength: 10, maxLength: 2000 })
  @IsString()
  @Transform(({ value }) => String(value ?? '').trim())
  @Length(10, 2000)
  message: string;
}
