import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/notification.dto';
import { NotificationTargetingService } from './notification-targeting.service';
import { RealtimeGateway, roomsForTarget } from '../realtime/realtime.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private targeting: NotificationTargetingService,
    private realtime: RealtimeGateway,
  ) {}

  async create(tenantId: string, dto: CreateNotificationDto) {
    const channel =
      (dto.channel as NotificationChannel | undefined) ?? NotificationChannel.IN_APP;
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.recipientStudentIds && dto.recipientStudentIds.length > 0) {
        const students = await tx.student.findMany({
          where: { id: { in: dto.recipientStudentIds }, tenantId },
          include: { guardians: { include: { guardian: true } } },
        });

        const notifications: Array<{ id: string; title: string; body: string; userId: string }> = [];
        for (const student of students) {
          for (const sg of student.guardians) {
            if (sg.guardian.userId) {
              const n = await tx.notification.create({
                data: {
                  tenantId,
                  userId: sg.guardian.userId,
                  type: 'STUDENT_MESSAGE',
                  title: dto.title,
                  body: dto.message,
                  channel,
                },
              });
              notifications.push({ id: n.id, title: n.title, body: n.body, userId: n.userId });
            }
          }
        }
        // Emit real-time notifications to guardians
        for (const notification of notifications) {
          await this.realtime.emitDomainEvent({
            kind: 'notification.created',
            rooms: roomsForTarget('STUDENT', notification.userId),
            payload: {
              id: notification.id,
              title: notification.title,
              body: notification.body,
            },
          });
        }
        return notifications;
      }

      if (!dto.targetType || !dto.targetId) {
        throw new BadRequestException(
          'targetType and targetId are required when no recipientStudentIds are provided',
        );
      }

      const userIds = await this.targeting.resolveTargetUserIds(
        tenantId,
        dto.targetType,
        dto.targetId,
      );

      const notifications: Array<{ id: string; title: string; body: string }> = [];
      for (const userId of userIds) {
        const n = await tx.notification.create({
          data: {
            tenantId,
            userId,
            type: dto.targetType === 'STUDENT' ? 'STUDENT_MESSAGE' : dto.targetType,
            title: dto.title,
            body: dto.message,
            channel,
          },
        });
        notifications.push({ id: n.id, title: n.title, body: n.body });
      }

      // Emit real-time notifications
      for (const notification of notifications) {
        await this.realtime.emitDomainEvent({
          kind: 'notification.created',
          rooms: roomsForTarget(dto.targetType, dto.targetId),
          payload: {
            id: notification.id,
            title: notification.title,
            body: notification.body,
          },
        });
      }

      return notifications;
    });
  }

  /**
   * Staff handoff notices (submit/approve/return): one stored row per user
   * plus a `notification.created` emit to each `user:{id}` room. Additive
   * helper — the targeting-based `create` path is untouched.
   */
  async notifyUsers(
    tenantId: string,
    userIds: string[],
    title: string,
    body: string,
    type = 'STAFF_NOTICE',
  ) {
    const recipients = [...new Set(userIds.filter(Boolean))];
    if (recipients.length === 0) return { notified: 0 };
    return this.prisma.withTenant(tenantId, async (tx) => {
      for (const userId of recipients) {
        const created = await tx.notification.create({
          data: {
            tenantId,
            userId,
            type,
            title,
            body,
            channel: NotificationChannel.IN_APP,
          },
        });
        await this.realtime.emitDomainEvent({
          kind: 'notification.created',
          rooms: roomsForTarget('STUDENT', created.userId),
          payload: { id: created.id, title: created.title, body: created.body },
        });
      }
      return { notified: recipients.length };
    });
  }

  async findMyNotifications(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.notification.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }
  async markAsRead(tenantId: string, notificationId: string, userId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      // Scope by userId as well as tenant: without it any member of the tenant
      // could mark another member's notification read.
      const existing = await tx.notification.findFirst({
        where: { id: notificationId, tenantId, userId },
      });
      if (!existing) throw new NotFoundException('Notification not found');

      return tx.notification.update({
        where: { id: notificationId },
        data: { status: 'READ', readAt: new Date() },
      });
    });
  }

  /** Marks every unread notification of the caller's own inbox read at once. */
  async markAllRead(tenantId: string, userId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const result = await tx.notification.updateMany({
        where: { tenantId, userId, readAt: null },
        data: { status: 'READ', readAt: new Date() },
      });
      return { marked: result.count };
    });
  }
}
