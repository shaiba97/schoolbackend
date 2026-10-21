import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export interface PlatformAdminContext {
  id: string;
  userId: string;
  role: 'SUPER_ADMIN' | 'SUPPORT';
  scope: 'platform';
}

/**
 * Gate for every platform controller. Requires BOTH a platform-scoped JWT
 * (scope === 'platform') and an ACTIVE platformAdmin row — so a leaked school
 * token, or a platform token minted before the admin was suspended, cannot
 * touch cross-tenant data. Attach the resolved admin on request.platformAdmin
 * for controllers (audit actor, impersonation sessions).
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as { user?: { userId?: string; scope?: string } })
      .user;

    if (!user?.userId || user.scope !== 'platform') {
      throw new ForbiddenException('Platform admin access required');
    }

    const admin = await this.prisma.platformAdmin.findUnique({
      where: { userId: user.userId },
    });

    if (!admin) {
      throw new ForbiddenException('Platform admin access required');
    }

    if (admin.status !== 'ACTIVE') {
      throw new ForbiddenException('Platform admin account is not active');
    }

    (request as { platformAdmin?: PlatformAdminContext }).platformAdmin = {
      id: admin.id,
      userId: user.userId,
      role: admin.role,
      scope: 'platform',
    };

    return true;
  }
}
