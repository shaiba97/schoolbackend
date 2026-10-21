import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { FINANCE_ROLES } from '../finance/finance-portal.roles';

/**
 * The fixed per-tenant room every finance-role member joins, so payment
 * events reach every finance view without per-user role-targeted emits.
 */
export function financeRoom(tenantId: string): string {
  return `tenant:${tenantId}:finance`;
}

/**
 * Real-time notification gateway.
 *
 * Authenticates socket connections using the same JWT as REST, then joins each
 * connected student to rooms matching their identity so notifications can be
 * pushed live without a page refresh.
 *
 * Rooms:
 *   user:{userId}          — individual notifications
 *   class:{classId}        — class-wide notifications
 *   grade:{level}:{grade} — grade-level notifications
 *   level:{educationLevel} — education-level notifications
 *   school-wide            — school-wide notifications
 *
 * The gateway is deny-by-default: a socket that fails authentication is
 * disconnected immediately.
 */
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const raw =
        (client.handshake.auth?.token as string | undefined) ??
        client.handshake.headers?.authorization ??
        null;
      const token = raw?.startsWith("Bearer ") ? raw.slice(7) : raw;
      if (!token) {
        this.logger.warn(`Socket ${client.id} rejected: no token`);
        client.disconnect(true);
        return;
      }

      const { userId, tenantId } = await this.verifyToken(token);

      // Verify the user has an ACTIVE membership in this tenant
      const membership = await this.prisma.tenantMembership.findFirst({
        where: { userId, tenantId, status: 'ACTIVE' },
      });

      if (!membership) {
        this.logger.warn(`Socket ${client.id} rejected: no active membership`);
        client.disconnect(true);
        return;
      }

      // A school locked by the provider is refused here too. The socket
      // would otherwise keep delivering live events to a school that can no
      // longer read anything through the API.
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, lockedAt: true, lockReason: true },
      });
      if (tenant?.lockedAt) {
        this.logger.warn(`Socket ${client.id} rejected: tenant is locked`);
        client.emit('tenant:locked', {
          code: 'TENANT_LOCKED',
          schoolName: tenant.name,
          lockedAt: tenant.lockedAt.toISOString(),
          reason: tenant.lockReason,
        });
        client.disconnect(true);
        return;
      }

      // Join identity rooms
      const rooms = await this.resolveRooms(userId, tenantId);
      await client.join(rooms);

      this.logger.log(`Socket ${client.id} connected as ${userId} in ${rooms.length} rooms`);
    } catch (error) {
      this.logger.warn(`Socket ${client.id} rejected: ${error}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket ${client.id} disconnected`);
  }

  /**
   * Verify the handshake credential. Socket tickets (audience `socket`,
   * minted by `GET /api/students/me/socket-ticket`) are tried first so a
   * ticket can never be mistaken for a session; plain session JWTs are
   * accepted as a fallback for non-browser clients that hold the token.
   */
  private async verifyToken(token: string): Promise<{ userId: string; tenantId: string }> {
    try {
      const ticket = await this.jwt.verifyAsync(token, { audience: 'socket' });
      const userId = ticket.sub as string;
      const tenantId = ticket.tenantId as string;
      if (!userId || !tenantId) throw new Error('incomplete ticket');
      return { userId, tenantId };
    } catch {
      const payload = await this.jwt.verifyAsync(token);
      const userId = payload.sub as string;
      const tenantId = payload.tenantId as string;
      if (!userId || !tenantId) throw new Error('incomplete token');
      return { userId, tenantId };
    }
  }

  /**
   * Resolve the set of rooms this user should join based on their identity.
   * A student joins user, class, grade, level, and school-wide rooms. A
   * guardian joins user and school-wide plus the class/grade/level rooms of
   * EVERY linked ward, so one connection covers a multi-child family.
   */
  private async resolveRooms(userId: string, tenantId: string): Promise<string[]> {
    const rooms = new Set<string>([`user:${userId}`, 'school-wide']);

    // Student identity
    const student = await this.prisma.student.findFirst({
      where: { tenantId, userId },
      select: { id: true, educationLevel: true, grade: true },
    });

    if (student) {
      // Active enrollment gives the class
      const enrollment = await this.prisma.studentEnrollment.findFirst({
        where: { tenantId, studentId: student.id, status: 'ACTIVE' },
        select: { classId: true },
      });

      if (enrollment) {
        rooms.add(`class:${enrollment.classId}`);
      }

      if (student.educationLevel && student.grade) {
        rooms.add(`grade:${student.educationLevel}:${student.grade}`);
        rooms.add(`level:${student.educationLevel}`);
      }
      return [...rooms];
    }

    // Guardian identity: rooms of every linked ward
    const guardian = await this.prisma.guardian.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    if (guardian) {
      const links = await this.prisma.studentGuardian.findMany({
        where: { tenantId, guardianId: guardian.id },
        include: {
          student: { select: { id: true, educationLevel: true, grade: true } },
        },
      });
      for (const link of links) {
        const enrollment = await this.prisma.studentEnrollment.findFirst({
          where: { tenantId, studentId: link.student.id, status: 'ACTIVE' },
          select: { classId: true },
        });
        if (enrollment) {
          rooms.add(`class:${enrollment.classId}`);
        }
        if (link.student.educationLevel && link.student.grade) {
          rooms.add(`grade:${link.student.educationLevel}:${link.student.grade}`);
          rooms.add(`level:${link.student.educationLevel}`);
        }
      }
    }

    // Finance-role staff join a fixed per-tenant room so payment.created
    // events reach every finance view in one emit.
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { tenantId, userId, status: 'ACTIVE' },
      select: { roles: { include: { role: { select: { slug: true } } } } },
    });
    const roleSlugs = (membership?.roles ?? []).map((mr) => mr.role?.slug ?? '');
    if (roleSlugs.some((slug) => (FINANCE_ROLES as readonly string[]).includes(slug))) {
      rooms.add(financeRoom(tenantId));
    }

    return [...rooms];
  }

  /**
   * Domain event contract. Every realtime payload is an invalidation signal,
   * never row contents: clients refetch the named query over REST, which stays
   * the source of truth. A room mistake can therefore misdirect attention but
   * never leak marks, results, or attendance rows.
   */
  async emitDomainEvent(event: {
    kind: 'notification.created' | 'marks.entered' | 'attendance.marked' | 'exam.published' | 'attendance_updated' | 'payment.recorded' | 'bus_trip_started' | 'bus_arrived_stop';
    rooms: string[];
    payload: Record<string, unknown>;
  }) {
    if (!this.server || event.rooms.length === 0) return;
    for (const room of event.rooms) {
      this.server.to(room).emit(event.kind, { kind: event.kind, ...event.payload });
    }
  }
}

/**
 * Room resolution shared by every emitter. Pure and synchronous so it is
 * trivially unit-testable: the room a notification reaches must be derivable
 * from (targetType, targetId) alone, with no database access.
 */
export function roomsForTarget(targetType: string, targetId: string | null): string[] {
  switch (targetType) {
    case 'STUDENT':
      return targetId ? [`user:${targetId}`] : [];
    case 'CLASS':
      return targetId ? [`class:${targetId}`] : [];
    case 'GRADE':
      if (!targetId) return [];
      // targetId format: "EDUCATION_LEVEL:GRADE"
      const [level, grade] = targetId.split(':');
      return [`grade:${level}:${grade}`];
    case 'EDUCATION_LEVEL':
      return targetId ? [`level:${targetId}`] : [];
    case 'SCHOOL_WIDE':
      return ['school-wide'];
    default:
      return [];
  }
}