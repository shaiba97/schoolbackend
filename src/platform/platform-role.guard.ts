import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

export const PLATFORM_ROLES_KEY = 'platformRoles';

/** Restrict a platform endpoint to specific platform admin roles. */
export const PlatformRoles = (...roles: string[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);

/**
 * Role gate for platform mutations. Platform admins are two-tier:
 * SUPER_ADMIN may change a school (status, modules, flags) while SUPPORT is
 * read-only. The guard reads the admin resolved by PlatformAdminGuard, so it
 * only ever runs after the platform scope and account status were verified.
 */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const admin = (request as { platformAdmin?: { role?: string } }).platformAdmin;
    if (!admin?.role || !requiredRoles.includes(admin.role)) {
      throw new ForbiddenException('This action requires super admin access');
    }
    return true;
  }
}
