import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  AuthResponseDto,
  TenantMembershipPayload,
} from './dto/auth-response.dto';
import { phoneLookupKey } from '../common/phone/phone.util';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  private async comparePasswords(
    plain: string,
    hashed: string,
  ): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  }

  /**
   * Phone sign-in.
   *
   * Phones are unique per tenant, not globally: the same household number can
   * legitimately appear in two schools, and the existing data already contains
   * numbers shared by several people. So the lookup is scoped to one tenant and
   * an ambiguous match is reported rather than silently picking the first row —
   * picking arbitrarily would either lock someone out or sign in the wrong user.
   */
  private async findUserByPhone(phone: string, tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException(
        'tenantId is required when signing in with a phone number',
      );
    }

    const matches = await this.prisma.user.findMany({
      where: {
        phone: phoneLookupKey(phone),
        memberships: { some: { tenantId, status: 'ACTIVE' } },
      },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: {
            tenant: true,
            roles: {
              include: { role: true },
            },
          },
        },
      },
      take: 2,
    });

    if (matches.length > 1) {
      throw new UnprocessableEntityException(
        'That phone number is registered more than once in this school. Contact an administrator to fix the duplicate.',
      );
    }

    return matches[0] ?? null;
  }

  /**
   * Employee-ID sign-in (teachers).
   *
   * Employee numbers are unique per tenant (@@unique([tenantId,
   * employeeNumber])), so unlike phones there is no ambiguity case: at most
   * one teacher row can match. Input is trimmed and uppercased to match the
   * generated format. An unknown ID resolves to null so the caller answers
   * with the same generic message as a bad password (no user oracle).
   */
  private async findUserByEmployeeNumber(
    employeeNumber: string,
    tenantId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        'tenantId is required when signing in with an employee ID',
      );
    }

    const normalized = employeeNumber.trim().toUpperCase();
    const teacher = await this.prisma.teacher.findFirst({
      where: { tenantId, employeeNumber: normalized },
      select: { userId: true },
    });
    if (!teacher) return null;

    return this.prisma.user.findUnique({
      where: { id: teacher.userId },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: {
            tenant: true,
            roles: {
              include: { role: true },
            },
          },
        },
      },
    });
  }

  /**
   * Resolve a login by student admission number. Role numbers are stored
   * as-given at admission (unlike generated employee IDs, which are always
   * uppercase), so the match is case-insensitive rather than normalized to
   * upper — either casing of a stored number must keep working. An unknown
   * number resolves to null so the caller answers with the same generic
   * message as a bad password (no user oracle).
   */
  private async findUserByStudentNumber(
    studentNumber: string,
    tenantId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        'tenantId is required when signing in with a student number',
      );
    }

    const normalized = studentNumber.trim();
    const student = await this.prisma.student.findFirst({
      where: {
        tenantId,
        roleNumber: { equals: normalized, mode: 'insensitive' },
      },
      select: { userId: true },
    });
    if (!student?.userId) return null;

    return this.prisma.user.findUnique({
      where: { id: student.userId },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: {
            tenant: true,
            roles: {
              include: { role: true },
            },
          },
        },
      },
    });
  }

  /**
   * Resolve a login by guardian number. Guardian numbers are generated
   * uppercase (like employee IDs) and unique per tenant
   * (@@unique([tenantId, guardian_number])), so the lookup normalizes to
   * upper and has no ambiguity case. A guardian without a linked user (or
   * an unknown number) resolves to null so the caller answers with the
   * same generic message as a bad password (no user oracle).
   */
  private async findUserByGuardianNumber(
    guardianNumber: string,
    tenantId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        'tenantId is required when signing in with a guardian ID',
      );
    }

    const normalized = guardianNumber.trim().toUpperCase();
    const guardian = await this.prisma.guardian.findFirst({
      where: { tenantId, guardianNumber: normalized },
      select: { userId: true },
    });
    if (!guardian?.userId) return null;

    return this.prisma.user.findUnique({
      where: { id: guardian.userId },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: {
            tenant: true,
            roles: {
              include: { role: true },
            },
          },
        },
      },
    });
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await this.hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        passwordHash,
      },
    });

    const memberships: TenantMembershipPayload[] = [];
    const tokenPayload: Record<string, unknown> = {
      sub: user.id,
      email: user.email,
    };

    const accessToken = await this.jwt.signAsync(tokenPayload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        createdAt: user.createdAt,
      },
      memberships,
    };
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const hasEmail = Boolean(dto.email?.trim());
    const hasPhone = Boolean(dto.phone?.trim());
    const hasEmployeeNumber = Boolean(dto.employeeNumber?.trim());
    const hasStudentNumber = Boolean(dto.studentNumber?.trim());
    const hasGuardianNumber = Boolean(dto.guardianNumber?.trim());
    const hasStaffNumber = Boolean(dto.staffNumber?.trim());
    const provided = [
      hasEmail,
      hasPhone,
      hasEmployeeNumber,
      hasStudentNumber,
      hasGuardianNumber,
      hasStaffNumber,
    ].filter(Boolean).length;
    if (provided !== 1) {
      throw new BadRequestException(
        provided === 0
          ? 'Provide an email address, phone number, employee ID, student number, guardian ID, or staff ID to sign in'
          : 'Provide email, phone, employee ID, student number, guardian ID, or staff ID — only one',
      );
    }

    const user = dto.phone
      ? await this.findUserByPhone(dto.phone, dto.tenantId)
      : dto.employeeNumber
        ? await this.findUserByEmployeeNumber(dto.employeeNumber, dto.tenantId)
        : dto.studentNumber
          ? await this.findUserByStudentNumber(dto.studentNumber, dto.tenantId)
          : dto.guardianNumber
            ? await this.findUserByGuardianNumber(
                dto.guardianNumber,
                dto.tenantId,
              )
            : dto.staffNumber
              ? await this.findUserByStaffNumber(dto.staffNumber, dto.tenantId)
              : await this.prisma.user.findUnique({
                  where: { email: dto.email },
                  include: {
                    memberships: {
                      where: { status: 'ACTIVE' },
                      include: {
                        tenant: true,
                        roles: {
                          include: { role: true },
                        },
                      },
                    },
                  },
                });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.comparePasswords(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    // Providers can lock a school (SUSPENDED / ARCHIVED / PENDING). Such
    // tenants must not accept sign-ins at all, and their memberships stay
    // invisible to the session. A login whose ONLY tenant is locked fails
    // outright.
    const loginable = user.memberships.filter(
      (m) => m.tenant.status === 'ACTIVE' || m.tenant.status === 'TRIAL',
    );
    if (user.memberships.length > 0 && loginable.length === 0) {
      throw new ForbiddenException(
        'This school is not accepting sign-ins right now. Contact support.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const activeMembership = loginable[0];
    const tenantId = activeMembership?.tenantId;
    const roleNames = activeMembership?.roles.map((mr) => mr.role.slug) || [];

    const tokenPayload: Record<string, unknown> = {
      sub: user.id,
      email: user.email,
    };
    if (tenantId) {
      tokenPayload.tenantId = tenantId;
      tokenPayload.roles = roleNames;
    }

    const accessToken = await this.jwt.signAsync(tokenPayload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        createdAt: user.createdAt,
      },
      memberships: loginable.map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        status: m.status,
        joinedAt: m.joinedAt,
        tenant: {
          id: m.tenant.id,
          name: m.tenant.name,
          slug: m.tenant.slug,
          currencyCode: m.tenant.currencyCode,
          timezone: m.tenant.timezone,
        },
        roles: m.roles.map((mr) => ({
          id: mr.role.id,
          name: mr.role.name,
          slug: mr.role.slug,
        })),
      })),
    };
  }

  /**
   * Own-profile update. A user may edit their own names, phone and avatar —
   * never roles, membership or status, which stay provisioning concerns.
   */
  async updateMe(
    userId: string,
    dto: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      avatarUrl?: string;
    },
  ): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) {
      if (!dto.firstName.trim())
        throw new BadRequestException('First name cannot be blank');
      data.firstName = dto.firstName.trim();
    }
    if (dto.lastName !== undefined)
      data.lastName = dto.lastName?.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone?.trim() || null;
    if (dto.avatarUrl !== undefined)
      data.avatarUrl = dto.avatarUrl?.trim() || null;

    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: userId }, data });
    }
    return this.me(userId);
  }

  /**
   * Change own password. Requires and verifies the current password so a
   * stolen session cannot silently take over the account.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account has no password set; contact an administrator',
      );
    }

    const valid = await this.comparePasswords(
      currentPassword,
      user.passwordHash,
    );
    if (!valid) throw new ForbiddenException('Current password is incorrect');
    if (newPassword === currentPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    return { changed: true };
  }

  async me(userId: string): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: {
            tenant: true,
            roles: {
              include: { role: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      accessToken: await this.jwt.signAsync({
        sub: user.id,
        email: user.email,
      }),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        createdAt: user.createdAt,
      },
      memberships: user.memberships.map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        status: m.status,
        joinedAt: m.joinedAt,
        tenant: {
          id: m.tenant.id,
          name: m.tenant.name,
          slug: m.tenant.slug,
          currencyCode: m.tenant.currencyCode,
          timezone: m.tenant.timezone,
        },
        roles: m.roles.map((mr) => ({
          id: mr.role.id,
          name: mr.role.name,
          slug: mr.role.slug,
        })),
      })),
    };
  }

  private async findUserByStaffNumber(staffNumber: string, tenantId?: string) {
    const user = await this.prisma.user.findFirst({
      where: { staffNumber },
      include: {
        memberships: {
          where: { status: 'ACTIVE', ...(tenantId ? { tenantId } : {}) },
          include: {
            tenant: true,
            roles: {
              include: { role: true },
            },
          },
        },
      },
    });
    return user;
  }
}
