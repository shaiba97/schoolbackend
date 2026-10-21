import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformActor } from './platform-tenants.service';

export type PlatformAuditQuery = {
  tenantId?: string;
  actorId?: string;
  action?: string;
  page?: number;
  limit?: number;
};

export type CreateAnnouncementInput = {
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  isActive?: boolean;
};

export type UpdateAnnouncementInput = {
  title?: string;
  body?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  isActive?: boolean;
};

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Platform audit trail and broadcast announcements. Both are cross-tenant
 * surfaces, so they read and write outside any tenant transaction.
 */
@Injectable()
export class PlatformOpsService {
  constructor(private prisma: PrismaService) {}

  async listAudit(query: PlatformAuditQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(query.limit) || DEFAULT_PAGE_SIZE),
    );

    const where: Record<string, unknown> = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.actorId) where.actorId = query.actorId;
    if (query.action?.trim()) {
      where.action = { contains: query.action.trim(), mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.platformAuditLog.count({ where }),
    ]);

    const tenantIds = [...new Set(rows.map((row) => row.tenantId).filter(Boolean))] as string[];
    const actorIds = [...new Set(rows.map((row) => row.actorId).filter(Boolean))] as string[];

    const [tenants, actors] = await Promise.all([
      tenantIds.length
        ? this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      actorIds.length
        ? this.prisma.platformAdmin.findMany({
            where: { id: { in: actorIds } },
            select: {
              id: true,
              user: { select: { firstName: true, lastName: true, email: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const tenantNames = new Map<string, string>(
      tenants.map((tenant) => [tenant.id, tenant.name] as [string, string]),
    );
    const actorNames = new Map<string, string>(
      actors.map((actor) => {
        const name =
          [actor.user.firstName, actor.user.lastName].filter(Boolean).join(' ') ||
          actor.user.email;
        return [actor.id, name] as [string, string];
      }),
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        tenantId: row.tenantId,
        tenantName: row.tenantId ? (tenantNames.get(row.tenantId) ?? null) : null,
        actorId: row.actorId,
        actorName: row.actorId ? (actorNames.get(row.actorId) ?? null) : null,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt,
        oldValues: row.oldValues,
        newValues: row.newValues,
      })),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async listAnnouncements() {
    const rows = await this.prisma.platformAnnouncement.findMany({
      orderBy: { publishedAt: 'desc' },
      include: {
        createdBy: {
          select: {
            id: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      severity: row.severity,
      isActive: row.isActive,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      author: row.createdBy
        ? [
            row.createdBy.user.firstName,
            row.createdBy.user.lastName,
          ]
            .filter(Boolean)
            .join(' ') || row.createdBy.user.email
        : null,
    }));
  }

  async createAnnouncement(
    input: CreateAnnouncementInput,
    actor: PlatformActor,
  ) {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('This action requires super admin access');
    }
    if (!input.title?.trim() || !input.body?.trim()) {
      throw new BadRequestException('A title and a body are required');
    }

    const announcement = await this.prisma.platformAnnouncement.create({
      data: {
        title: input.title.trim(),
        body: input.body.trim(),
        severity: input.severity ?? 'INFO',
        isActive: input.isActive ?? true,
        createdById: actor.id,
      },
    });

    await this.prisma.platformAuditLog.create({
      data: {
        actorId: actor.id,
        action: 'announcement.created',
        entityType: 'platform_announcement',
        entityId: announcement.id,
        newValues: {
          title: announcement.title,
          severity: announcement.severity,
          isActive: announcement.isActive,
        },
        ipAddress: actor.ip,
        userAgent: actor.userAgent?.slice(0, 255),
      },
    });

    return announcement;
  }

  async updateAnnouncement(
    id: string,
    input: UpdateAnnouncementInput,
    actor: PlatformActor,
  ) {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('This action requires super admin access');
    }

    const existing = await this.prisma.platformAnnouncement.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Announcement not found');

    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.body !== undefined) data.body = input.body.trim();
    if (input.severity !== undefined) data.severity = input.severity;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const announcement = await this.prisma.platformAnnouncement.update({
      where: { id },
      data,
    });

    await this.prisma.platformAuditLog.create({
      data: {
        actorId: actor.id,
        action: 'announcement.updated',
        entityType: 'platform_announcement',
        entityId: id,
        oldValues: {
          title: existing.title,
          severity: existing.severity,
          isActive: existing.isActive,
        },
        newValues: {
          title: announcement.title,
          severity: announcement.severity,
          isActive: announcement.isActive,
        },
        ipAddress: actor.ip,
        userAgent: actor.userAgent?.slice(0, 255),
      },
    });

    return announcement;
  }
}
