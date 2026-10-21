import { IsEmail, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiPropertyOptional({ description: 'Email address. Mutually exclusive with phone, employeeNumber, and studentNumber.' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description:
      'Phone number. Accepts +2499XXXXXXXX, 09XXXXXXXX or 9XXXXXXXX. Requires tenantId. Mutually exclusive with email, employeeNumber, and studentNumber.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Teacher employee ID, e.g. 26CPM001 (case-insensitive). Requires tenantId. Mutually exclusive with email, phone, and studentNumber.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  employeeNumber?: string;

  @ApiPropertyOptional({
    description:
      'Student admission number (roleNumber), e.g. 26CS1R01 (case-insensitive). Requires tenantId. Mutually exclusive with email, phone, employeeNumber, and guardianNumber.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  studentNumber?: string;

  @ApiPropertyOptional({
    description:
      'Guardian number, e.g. 26CPG0001 (case-insensitive). Requires tenantId. Mutually exclusive with email, phone, employeeNumber, and studentNumber.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  guardianNumber?: string;

  @ApiPropertyOptional({
    description:
      'Staff ID, e.g. STF-12345 (case-insensitive). Requires tenantId. Mutually exclusive with email, phone, employeeNumber, studentNumber, and guardianNumber.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  staffNumber?: string;

  @ApiPropertyOptional({
    description: 'Required with phone, employeeNumber, studentNumber, guardianNumber, or staffNumber: all are unique per tenant, not globally.',
  })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiProperty()
  @IsString()
  password: string;
}
