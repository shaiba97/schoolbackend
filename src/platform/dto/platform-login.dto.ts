import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class PlatformLoginDto {
  @ApiProperty({ example: 'root@platform.dev' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'changeme' })
  @IsString()
  @MinLength(8)
  password!: string;
}

export interface PlatformAuthResponseDto {
  accessToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName?: string | null;
    avatarUrl?: string | null;
  };
  profile: {
    id: string;
    role: 'SUPER_ADMIN' | 'SUPPORT';
    lastLoginAt?: Date | null;
  };
}
