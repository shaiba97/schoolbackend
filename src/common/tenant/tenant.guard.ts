import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantLockedException } from './tenant-locked.exception';

export interface TenantContext {
  tenantId: string;
  membershipId: string;
  roles: string[];
}

/** Tenant states that keep defying logins and API access. */
const BLOCKED_TENANT_STATUSES = ['SUSPENDED', 'ARCHIVED', 'PENDING'] as const;

const BLOCKED_TENANT_MESSAGE =
  'This school is currently locked by the provider. Contact support.';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as unknown as
      | { userId?: string; scope?: string; roles?: string[] }
      | undefined;
    const tenantId = request.headers['x-tenant-id'] as string | undefined;

    if (process.env.AUTH_NO_SESSION === 'true') {
      const fallbackTenant = tenantId || process.env.AUTH_TENANT_ID || '';
      (request as any).tenant = {
        tenantId: fallbackTenant,
        membershipId: 'no-session-membership',
        roles: ['ADMIN', 'ACADEMIC_ADMIN', 'TEACHER', 'STUDENT'],
      } satisfies TenantContext;
      return true;
    }

    if (!user?.userId) {
      throw new UnauthorizedException();
    }

    if (!tenantId) {
      throw new ForbiddenException('Missing X-Tenant-Id header');
    }

    // Super-admin escape hatch: a platform-scoped JWT may act on ANY tenant
    // (impersonation, support, provisioning) — including LOCKED tenants,
    // which is exactly when operators need in. It bypasses membership
    // checks entirely.
    if (user.scope === 'platform') {
      (request as any).tenant = {
        tenantId,
        membershipId: 'platform',
        roles: user.roles && user.roles.length > 0 ? user.roles : ['ADMIN'],
      } satisfies TenantContext;
      return true;
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        userId: user.userId,
        tenantId,
        status: 'ACTIVE',
      },
      include: {
        tenant: {
          select: { status: true, name: true, lockedAt: true, lockReason: true },
        },
        roles: {
          include: { role: true },
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'You are not an active member of this tenant',
      );
    }

    if (BLOCKED_TENANT_STATUSES.includes(membership.tenant.status as never)) {
      // A school locked over an ended licence gets the full explanation, so
      // its portal can show why access stopped. Other blocked states keep
      // the generic message.
      if (membership.tenant.lockedAt) {
        throw new TenantLockedException({
          schoolName: membership.tenant.name,
          lockedAt: membership.tenant.lockedAt,
          reason: membership.tenant.lockReason,
        });
      }
      throw new ForbiddenException(BLOCKED_TENANT_MESSAGE);
    }

    const roleNames = membership.roles.map((mr) => mr.role.slug);

    (request as any).tenant = {
      tenantId,
      membershipId: membership.id,
      roles: roleNames,
    } satisfies TenantContext;

    return true;
  }
}
