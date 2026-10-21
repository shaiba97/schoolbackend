import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { CreateStaffDto, UpdateStaffDto, UpdateStaffStatusDto, StaffQueryDto, ResetStaffPasswordDto } from './dto/staff.dto';

/** Role slugs that carry portal login access. */
export const SYSTEM_POSITION_SLUGS = ['RECEPTIONIST', 'ACADEMIC_ADMIN', 'ACCOUNTANT', 'TRANSPORT_COORDINATOR'] as const;
/** Operational (non-login) position slugs — membership rows auto-created, no credentials. */
export const OPERATIONAL_POSITION_SLUGS = ['PRINCIPAL', 'JANITOR', 'LIBRARIAN'] as const;
/** Per-staff custom roles are minted as CUSTOM_<token>; the human title lives in role.name. */
export const CUSTOM_ROLE_PREFIX = 'CUSTOM_';

/** Prompt vocabulary -> stored role slug. */
const POSITION_TO_SLUG: Record<string, string> = {
  FINANCIAL_AFFAIRS: 'ACCOUNTANT',
  ACADEMIC_AFFAIRS: 'ACADEMIC_ADMIN',
  RECEPTIONIST: 'RECEPTIONIST',
  TRANSPORT_COORDINATOR: 'TRANSPORT_COORDINATOR',
  PRINCIPAL: 'PRINCIPAL',
  JANITOR: 'JANITOR',
  LIBRARIAN: 'LIBRARIAN',
};

/** Stored role slug -> prompt vocabulary (CUSTOM_* handled separately). */
const SLUG_TO_POSITION: Record<string, string> = {
  ACCOUNTANT: 'FINANCIAL_AFFAIRS',
  ACADEMIC_ADMIN: 'ACADEMIC_AFFAIRS',
  RECEPTIONIST: 'RECEPTIONIST',
  TRANSPORT_COORDINATOR: 'TRANSPORT_COORDINATOR',
  PRINCIPAL: 'PRINCIPAL',
  JANITOR: 'JANITOR',
  LIBRARIAN: 'LIBRARIAN',
};

/** Legacy `role` slug -> prompt vocabulary (deprecated caller compat). */
const LEGACY_ROLE_TO_POSITION: Record<string, string> = {
  ACCOUNTANT: 'FINANCIAL_AFFAIRS',
  ACADEMIC_ADMIN: 'ACADEMIC_AFFAIRS',
  RECEPTIONIST: 'RECEPTIONIST',
};

const POSITION_LABEL: Record<string, string> = {
  FINANCIAL_AFFAIRS: 'Financial Affairs (Accountant)',
  ACADEMIC_AFFAIRS: 'Academic Affairs',
  RECEPTIONIST: 'Receptionist',
  TRANSPORT_COORDINATOR: 'Transport Coordinator',
  PRINCIPAL: 'Principal',
  JANITOR: 'Janitor',
  LIBRARIAN: 'Librarian',
  CUSTOM: 'Custom',
};

/** Single source of truth for a human-facing position title: custom roles
 *  carry the title in role.name; canonical slugs resolve through the
 *  prompt-vocabulary label table. */
export function positionTitleFor(
  slug: string,
  name: string | null | undefined,
): string {
  if (slug.startsWith(CUSTOM_ROLE_PREFIX)) {
    return name ?? 'Custom';
  }
  const positionKey = SLUG_TO_POSITION[slug] ?? slug;
  return POSITION_LABEL[positionKey] ?? name ?? 'Custom';
}

const STAFF_NUMBER_PREFIX: Record<string, string> = {
  FINANCIAL_AFFAIRS: 'ACC',
  ACADEMIC_AFFAIRS: 'ACD',
  RECEPTIONIST: 'REC',
  TRANSPORT_COORDINATOR: 'TRC',
  PRINCIPAL: 'PRI',
  JANITOR: 'JAN',
  LIBRARIAN: 'LIB',
  CUSTOM: 'CUS',
};

interface ResolvedPosition {
  key: string;
  slug: string;
  title: string;
  system: boolean;
}

@Injectable()
export class StaffService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  /**
   * Short-lived credential for the socket handshake, for every staff surface
   * without its own /me module (admin, academic affairs). No extra lookup:
   * the TenantGuard already verified an ACTIVE membership before this runs,
   * and the gateway re-verifies the ticket audience at handshake time.
   */
  async mintSocketTicket(tenantId: string, userId: string) {
    const ticket = await this.jwt.signAsync(
      { sub: userId, tenantId },
      { expiresIn: '600s', audience: 'socket' },
    );
    return { ticket, expiresIn: 600 };
  }

  /**
   * Own-profile read for staff portals without an admin role (e.g. the
   * transport coordinator). Identity comes from the JWT, never from input,
   * and the lookup is scoped to the caller's tenant with ACTIVE memberships
   * only, so credentials never leak past the class-guard boundary.
   */
  async getProfile(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const user = await db.user.findFirst({
        where: { id: userId, status: { not: 'DELETED' } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          staffNumber: true,
          phone: true,
          email: true,
          avatarUrl: true,
          status: true,
          memberships: {
            where: { tenantId, status: 'ACTIVE' },
            select: {
              tenant: { select: { id: true, name: true } },
              roles: { select: { role: { select: { slug: true, name: true } } } },
            },
          },
        },
      });

      if (!user || user.memberships.length === 0) {
        throw new NotFoundException('No staff profile found');
      }

      const membership = user.memberships[0];
      const roleRows = membership.roles.map((r) => r.role);
      const primary = roleRows[0] ?? null;
      const slugs = roleRows.map((r) => r.slug);

      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: [user.firstName, user.lastName].filter(Boolean).join(' '),
        staffNumber: user.staffNumber,
        phone: user.phone,
        email: user.email,
        avatarUrl: user.avatarUrl,
        status: user.status,
        position: primary ? (SLUG_TO_POSITION[primary.slug] ?? primary.slug) : 'CUSTOM',
        positionTitle: primary ? positionTitleFor(primary.slug, primary.name) : 'Custom',
        roles: slugs,
        tenant: membership.tenant,
      };
    });
  }

  /** Matches every staff directory row: system + operational slugs, plus per-staff custom roles. */
  private staffRoleFilter() {
    return {
      role: {
        OR: [
          { slug: { in: [...SYSTEM_POSITION_SLUGS, ...OPERATIONAL_POSITION_SLUGS] } },
          { slug: { startsWith: CUSTOM_ROLE_PREFIX } },
        ],
      },
    };
  }

  private hasSystemAccess(roleSlugs: string[]): boolean {
    return roleSlugs.some((s) => (SYSTEM_POSITION_SLUGS as readonly string[]).includes(s));
  }

  private primaryRoleOf(row: any): { slug: string; name: string } | null {
    return row.memberships?.[0]?.roles?.[0]?.role ?? null;
  }

  /** Enrich a directory row with prompt-vocabulary position fields (memberships kept for compat). */
  private shapeRow(row: any) {
    const role = this.primaryRoleOf(row);
    const slugs = (row.memberships ?? []).flatMap((m: any) => (m.roles ?? []).map((r: any) => r.role.slug));
    let position = 'CUSTOM';
    if (role && !role.slug.startsWith(CUSTOM_ROLE_PREFIX)) {
      position = SLUG_TO_POSITION[role.slug] ?? role.slug;
    }
    const positionTitle = role ? positionTitleFor(role.slug, role.name) : 'Custom';
    return { ...row, position, positionTitle, hasSystemAccess: this.hasSystemAccess(slugs) };
  }

  private resolvePosition(dto: { position?: string; customPositionTitle?: string; role?: string }): ResolvedPosition {
    const key = dto.position ?? (dto.role ? LEGACY_ROLE_TO_POSITION[dto.role] : undefined);
    if (!key) throw new BadRequestException('Position is required');
    if (key === 'CUSTOM') {
      const title = dto.customPositionTitle?.trim();
      if (!title) throw new BadRequestException('Custom position title is required');
      const token = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
      return { key, slug: `${CUSTOM_ROLE_PREFIX}${token}`, title, system: false };
    }
    const slug = POSITION_TO_SLUG[key];
    if (!slug) throw new BadRequestException(`Unknown position: ${key}`);
    return { key, slug, title: POSITION_LABEL[key], system: (SYSTEM_POSITION_SLUGS as readonly string[]).includes(slug) };
  }

  private getRolePrefix(positionKey: string): string {
    return STAFF_NUMBER_PREFIX[positionKey] || 'STF';
  }

  private async generateStaffNumber(tx: { user: { findMany: (args: any) => Promise<Array<{ staffNumber: string | null }>> } }, positionKey: string): Promise<string> {
    const year = new Date().getFullYear().toString().slice(-2);
    const prefix = this.getRolePrefix(positionKey);
    const pattern = `${year}${prefix}`;

    const existing = await tx.user.findMany({
      where: { staffNumber: { startsWith: pattern } },
      select: { staffNumber: true },
      orderBy: { staffNumber: 'desc' },
      take: 1,
    });

    const lastNumber = existing[0]?.staffNumber;
    const lastSeq = lastNumber ? parseInt(lastNumber.slice(-4), 10) : 0;
    const nextSeq = lastSeq + 1;

    return `${pattern}${nextSeq.toString().padStart(4, '0')}`;
  }

  /** Next staff number for a position, without creating — powers the form preview. */
  async previewStaffNumber(positionKey: string): Promise<{ staffNumber: string }> {
    const pos = this.resolvePosition({ position: positionKey });
    const staffNumber = await this.generateStaffNumber(this.prisma, pos.key);
    return { staffNumber };
  }

  async list(tenantId: string, query: StaffQueryDto) {
    const where: Record<string, unknown> = {
      status: { not: 'DELETED' },
      memberships: {
        some: {
          tenantId,
          status: 'ACTIVE',
          roles: { some: this.staffRoleFilter() },
        },
      },
    };

    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { staffNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.role) {
      const roleClause =
        query.role === 'CUSTOM'
          ? { slug: { startsWith: CUSTOM_ROLE_PREFIX } }
          : { slug: POSITION_TO_SLUG[query.role] ?? query.role };
      where.memberships = {
        some: {
          tenantId,
          status: 'ACTIVE',
          roles: { some: { role: roleClause } },
        },
      };
    }

    const rows = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        staffNumber: true,
        status: true,
        createdAt: true,
        memberships: {
          where: { tenantId, status: 'ACTIVE' },
          select: {
            roles: {
              select: { role: { select: { slug: true, name: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.shapeRow(r));
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        status: { not: 'DELETED' },
        memberships: {
          some: {
            tenantId,
            status: 'ACTIVE',
            roles: { some: this.staffRoleFilter() },
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        staffNumber: true,
        status: true,
        createdAt: true,
        memberships: {
          where: { tenantId, status: 'ACTIVE' },
          select: {
            roles: {
              select: { role: { select: { slug: true, name: true } } },
            },
          },
        },
      },
    });

    if (!user) throw new NotFoundException('Staff member not found');
    return this.shapeRow(user);
  }

  private splitFullName(fullName: string): { firstName: string; lastName: string | null } {
    const parts = fullName.trim().split(/\s+/);
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') || null };
  }

  async create(tenantId: string, dto: CreateStaffDto) {
    const pos = this.resolvePosition(dto);
    if (pos.system) {
      if (!dto.password || dto.password.length < 8) {
        throw new BadRequestException('Password is required for portal access roles');
      }
    } else if (dto.password) {
      throw new BadRequestException('Staff without portal access must not set a password');
    }
    const passwordHash = pos.system ? await bcrypt.hash(dto.password!, 10) : null;
    const { firstName, lastName } = this.splitFullName(dto.fullName);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { phone: dto.phone },
      });
      if (existing) {
        throw new ConflictException('A user with this phone number already exists');
      }

      const staffNumber = await this.generateStaffNumber(tx, pos.key);

      const user = await tx.user.create({
        data: {
          firstName,
          lastName,
          phone: dto.phone,
          staffNumber,
          passwordHash,
          status: 'ACTIVE',
        },
        select: { id: true, firstName: true, lastName: true, phone: true, staffNumber: true, status: true },
      });

      const membership = await tx.tenantMembership.create({
        data: { tenantId, userId: user.id, status: 'ACTIVE' },
      });

      // CUSTOM mints a per-staff role carrying the human title; fixed positions share one row.
      let role = pos.key === 'CUSTOM' ? null : await tx.role.findFirst({
        where: { tenantId, slug: pos.slug },
      });
      if (!role) {
        role = await tx.role.create({
          data: { tenantId, name: pos.title, slug: pos.slug, scope: 'TENANT' },
        });
      }

      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: role.id },
      });

      return { ...user, position: pos.key, positionTitle: pos.title, hasSystemAccess: pos.system, role: pos.slug };
    });
  }

  async update(tenantId: string, id: string, dto: UpdateStaffDto, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException('Cannot edit your own account through this screen');
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: {
          id,
          status: { not: 'DELETED' },
          memberships: {
            some: {
              tenantId,
              status: 'ACTIVE',
              roles: { some: this.staffRoleFilter() },
            },
          },
        },
      });
      if (!user) throw new NotFoundException('Staff member not found');

      const data: Record<string, unknown> = { phone: dto.phone };
      if (dto.fullName) {
        const { firstName, lastName } = this.splitFullName(dto.fullName);
        data.firstName = firstName;
        data.lastName = lastName;
      }

      await tx.user.update({ where: { id }, data });

      if (dto.position || dto.role) {
        const pos = this.resolvePosition(dto);
        const membership = await tx.tenantMembership.findFirst({
          where: { tenantId, userId: id, status: 'ACTIVE' },
        });
        if (membership) {
          // Single-position invariant: replace, never append.
          await tx.membershipRole.deleteMany({ where: { membershipId: membership.id } });
          let role = pos.key === 'CUSTOM' ? null : await tx.role.findFirst({
            where: { tenantId, slug: pos.slug },
          });
          if (!role) {
            role = await tx.role.create({
              data: { tenantId, name: pos.title, slug: pos.slug, scope: 'TENANT' },
            });
          }
          await tx.membershipRole.create({
            data: { membershipId: membership.id, roleId: role.id },
          });
        }
      }
    });

    // Re-read after commit (an in-transaction read would see stale memberships).
    return this.findOne(tenantId, id);
  }

  async resetPassword(tenantId: string, id: string, dto: ResetStaffPasswordDto, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException('Cannot reset your own password through this screen');
    }
    const target: any = await this.findOne(tenantId, id);
    if (!target.hasSystemAccess) {
      throw new BadRequestException('Cannot reset password for staff with no portal access');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash },
      select: { id: true, firstName: true, lastName: true, status: true },
    });
  }

  async updateStatus(tenantId: string, id: string, dto: UpdateStaffStatusDto, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException('Cannot change your own status');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id,
        status: { not: 'DELETED' },
        memberships: {
          some: {
            tenantId,
            status: 'ACTIVE',
            roles: { some: this.staffRoleFilter() },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Staff member not found');

    return this.prisma.user.update({
      where: { id },
      data: { status: dto.status as 'ACTIVE' | 'SUSPENDED' },
      select: { id: true, firstName: true, lastName: true, status: true },
    });
  }

  async softDelete(tenantId: string, id: string, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException('Cannot delete your own account');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id,
        status: { not: 'DELETED' },
        memberships: {
          some: {
            tenantId,
            status: 'ACTIVE',
            roles: { some: this.staffRoleFilter() },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Staff member not found');

    return this.prisma.user.update({
      where: { id },
      data: { status: 'DELETED' },
      select: { id: true, firstName: true, lastName: true, status: true },
    });
  }
}
