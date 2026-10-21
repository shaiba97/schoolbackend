import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reusable ward-link gate for every guardian-portal endpoint that takes a
 * `:childId` param. Verifies server-side that the authenticated guardian is
 * actually linked to the requested student via `student_guardians` — the
 * client-supplied id is never trusted on its own (IDOR boundary for the
 * whole portal). Routes without a `:childId` param pass through.
 *
 * Runs after JwtAuthGuard + TenantGuard + RolesGuard, so `request.user` and
 * `request.tenant` are already populated.
 */
@Injectable()
export class WardGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest() as {
      params?: { childId?: string };
      tenant?: { tenantId?: string };
      user?: { userId?: string };
    };
    const childId = request.params?.childId;
    if (!childId) return true;

    const tenantId = request.tenant?.tenantId;
    const userId = request.user?.userId;
    if (!tenantId || !userId) {
      throw new ForbiddenException('Guardian session is missing');
    }

    const guardian = await this.prisma.guardian.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    if (!guardian) {
      throw new ForbiddenException(
        'No guardian profile exists for this account in this school',
      );
    }

    const link = await this.prisma.studentGuardian.findFirst({
      where: { tenantId, guardianId: guardian.id, studentId: childId },
      select: { studentId: true },
    });
    if (!link) {
      throw new ForbiddenException('This student is not one of your wards');
    }
    return true;
  }
}
