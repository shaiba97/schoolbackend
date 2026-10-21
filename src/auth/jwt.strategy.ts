import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

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
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
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

  validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token');
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
