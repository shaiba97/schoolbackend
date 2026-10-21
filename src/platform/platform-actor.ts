import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import type { PlatformActor } from './platform-tenants.service';

/**
 * Builds the audit actor from the request. PlatformAdminGuard has already
 * verified the platform scope and the admin's ACTIVE status, so a missing
 * admin here means the route was reached without that guard — fail closed.
 */
export function platformActor(request: Request): PlatformActor {
  const admin = (
    request as {
      platformAdmin?: {
        id: string;
        userId: string;
        role: 'SUPER_ADMIN' | 'SUPPORT';
      };
    }
  ).platformAdmin;

  if (!admin) {
    throw new ForbiddenException('Platform admin access required');
  }

  return {
    id: admin.id,
    userId: admin.userId,
    role: admin.role,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  };
}
