import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BLOCKED_TENANT_STATUSES } from '../common/tenant/tenant.guard';

export interface JwtPayload {
  sub: string;
  /** Null for phone-only accounts (teachers are identified by phone). */
  email?: string | null;
  tenantId?: string;
  roles?: string[];
  /** Set to 'platform' on super-admin control plane tokens. */
  scope?: 'platform';
  /** Platform admin role (SUPER_ADMIN | SUPPORT) when scope is 'platform'. */
  role?: 'SUPER_ADMIN' | 'SUPPORT';
  /** Issued-at, in seconds since epoch (set automatically when signing). */
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Session invalidation for suspended/locked schools.
   *
   * TenantGuard already rejects locked tenants on guarded endpoints, but
   * unguarded surfaces (auth/me, tenants, and anything that forgets the
   * guard) would still accept a validly-signed session token. This check
   * rejects such tokens at the strategy itself:
   *
   * - the tenant's status is blocked (SUSPENDED | ARCHIVED | PENDING), or
   * - the token was issued at or before the moment the school was locked
   *   (iat <= lockedAt). Tokens minted after the school was unlocked are
   *   accepted again — renewing an expired licence and manual unarchive
   *   both clear status/lockedAt, so the unlock path restores sessions.
   *
   * Fail-closed on the equality boundary: a token issued in the same second
   * as the lock is rejected. iat and lockedAt are both written by this
   * service's clock, so there is no cross-host skew to tolerate.
   *
   * Platform-scoped and tenant-less tokens (super-admins, phone-only
   * pre-auth flows) are outside tenant lockdown and skip the check. A
   * token naming a tenant that no longer exists is left to the guards and
   * downstream membership checks, as before.
   */
  async validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token');
    }

    if (payload.tenantId && payload.scope !== 'platform') {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: payload.tenantId },
        select: { status: true, lockedAt: true },
      });
      if (tenant) {
        if (BLOCKED_TENANT_STATUSES.includes(tenant.status as never)) {
          throw new UnauthorizedException(
            'This school is currently locked by the provider. Contact support.',
          );
        }
        if (
          typeof payload.iat === 'number' &&
          tenant.lockedAt &&
          payload.iat <= Math.floor(tenant.lockedAt.getTime() / 1000)
        ) {
          throw new UnauthorizedException(
            'This session was issued before the school was locked. Sign in again.',
          );
        }
      }
    }

    return {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      roles: payload.roles || [],
      scope: payload.scope,
      role: payload.role,
    };
  }
}
