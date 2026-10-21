import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
  PlatformLoginDto,
  PlatformAuthResponseDto,
} from './dto/platform-login.dto';
import * as bcrypt from 'bcrypt';

/**
 * Authentication for the super-admin control plane. Reuses the users table so
 * a platform admin is a normal user with an attached active platformAdmin
 * row; the JWT carries scope: 'platform' which every platform endpoint
 * (PlatformAdminGuard) and every cross-tenant escape hatch (TenantGuard bypass)
 * requires. Tenant-scoped tokens NEVER satisfy these checks — scope hopping
 * from a school JWT to the control plane is impossible by token content alone.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async platformLogin(dto: PlatformLoginDto): Promise<PlatformAuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { platformAdmin: true },
    });

    if (!user || !user.passwordHash || !user.platformAdmin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.platformAdmin.status !== 'ACTIVE') {
      throw new UnauthorizedException('Platform admin account is not active');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.prisma.platformAdmin.update({
      where: { id: user.platformAdmin.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = await this.signToken(user, user.platformAdmin);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email!,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
      },
      profile: {
        id: user.platformAdmin.id,
        role: user.platformAdmin.role,
        lastLoginAt: new Date(),
      },
    };
  }

  async platformMe(userId: string): Promise<PlatformAuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { platformAdmin: true },
    });

    if (!user || !user.platformAdmin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.signToken(user, user.platformAdmin);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email!,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
      },
      profile: {
        id: user.platformAdmin.id,
        role: user.platformAdmin.role,
        lastLoginAt: user.platformAdmin.lastLoginAt,
      },
    };
  }

  private async signToken(
    user: { id: string; email: string | null },
    admin: { role: 'SUPER_ADMIN' | 'SUPPORT' },
  ): Promise<string> {
    return this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      scope: 'platform',
      role: admin.role,
    });
  }
}
