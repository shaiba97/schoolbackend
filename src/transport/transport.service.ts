import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusStatus, NotificationChannel, TransportShift } from '@prisma/client';
import { FinancePortalService } from '../finance/finance-portal.service';
import { RealtimeGateway, roomsForTarget } from '../realtime/realtime.gateway';
import {
  AssignStudentDto,
  AssignStudentsBatchDto,
  CreateRouteDto,
  CreateVehicleDto,
  ReplaceStopsDto,
  TransportListQueryDto,
  UpdateRouteDto,
  UpdateVehicleDto,
} from './dto/transport.dto';

const BUS_STATUSES = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'] as const;
const ETA_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function fullName(s: any): string {
  return [s.firstName, s.middleName, s.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
}

@Injectable()
export class TransportService {
  constructor(
    private prisma: PrismaService,
    private finance: FinancePortalService,
    private realtime: RealtimeGateway,
  ) {}

  async getDashboard(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const now = new Date();
      const dayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const dayEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );

      const [buses, routeCount, assignedCount, tripsToday] = await Promise.all([
        tx.bus.findMany({ where: { tenantId }, select: { status: true } }),
        tx.transportRoute.count({ where: { tenantId } }),
        tx.transportAssignment.count({ where: { tenantId } }),
        tx.transportTrip.findMany({
          where: {
            route: { tenantId },
            tripDate: { gte: dayStart, lt: dayEnd },
          },
          select: { status: true },
        }),
      ]);

      const countByStatus = (s: string) =>
        buses.filter((b) => b.status === s).length;

      return {
        vehicles: {
          total: buses.length,
          active: countByStatus('ACTIVE'),
          maintenance: countByStatus('MAINTENANCE'),
          inactive: countByStatus('INACTIVE'),
        },
        routes: routeCount,
        studentsAssigned: assignedCount,
        tripsToday: {
          total: tripsToday.length,
          inProgress: tripsToday.filter((t) => t.status === 'IN_PROGRESS')
            .length,
          completed: tripsToday.filter((t) => t.status === 'COMPLETED').length,
        },
      };
    });
  }

  // ----- vehicles -----

  async listVehicles(tenantId: string, query: TransportListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const search = query.search?.trim();

    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const where: any = {
        tenantId,
        ...(search
          ? {
              OR: [
                { plateNumber: { contains: search, mode: 'insensitive' } },
                { model: { contains: search, mode: 'insensitive' } },
                { driverName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [data, total] = await Promise.all([
        tx.bus.findMany({
          where,
          include: { _count: { select: { routes: true } } },
          orderBy: { plateNumber: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.bus.count({ where }),
      ]);
      return { data, total, page, limit };
    });
  }

  async getVehicle(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const bus = await tx.bus.findFirst({
        where: { id, tenantId },
        include: {
          routes: {
            orderBy: { name: 'asc' },
            include: {
              _count: { select: { stops: true, assignments: true } },
            },
          },
        },
      });
      if (!bus) throw new NotFoundException('Bus not found');
      return bus;
    });
  }

  async createVehicle(tenantId: string, dto: CreateVehicleDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const dup = await tx.bus.findFirst({
        where: {
          tenantId,
          plateNumber: { equals: dto.plateNumber, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (dup)
        throw new ConflictException(
          'A bus with this plate number already exists',
        );

      return tx.bus.create({
        data: {
          tenantId,
          plateNumber: dto.plateNumber.trim(),
          model: dto.model.trim(),
          capacity: dto.capacity,
          driverName: dto.driverName.trim(),
          driverPhone: dto.driverPhone.trim(),
          driverLicenseNumber: dto.driverLicenseNumber.trim(),
          driverEmergencyContact: dto.driverEmergencyContact.trim(),
          status: (dto.status ?? 'ACTIVE') as BusStatus,
        },
      });
    });
  }

  async updateVehicle(tenantId: string, id: string, dto: UpdateVehicleDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const bus = await tx.bus.findFirst({ where: { id, tenantId } });
      if (!bus) throw new NotFoundException('Bus not found');

      if (
        dto.plateNumber &&
        dto.plateNumber.toLowerCase() !== bus.plateNumber.toLowerCase()
      ) {
        const dup = await tx.bus.findFirst({
          where: {
            tenantId,
            plateNumber: { equals: dto.plateNumber, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (dup)
          throw new ConflictException(
            'A bus with this plate number already exists',
          );
      }

      const data: any = {};
      const fields = [
        'plateNumber',
        'model',
        'capacity',
        'driverName',
        'driverPhone',
        'driverLicenseNumber',
        'driverEmergencyContact',
        'status',
      ];
      for (const key of fields) {
        if ((dto as any)[key] !== undefined) data[key] = (dto as any)[key];
      }
      return tx.bus.update({ where: { id: bus.id }, data });
    });
  }

  async deleteVehicle(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const bus = await tx.bus.findFirst({ where: { id, tenantId } });
      if (!bus) throw new NotFoundException('Bus not found');

      const routeUse = await tx.transportRoute.count({
        where: { tenantId, busId: id },
      });
      if (routeUse > 0) {
        throw new ConflictException(
          'This bus is assigned to a route; remove it from the route first',
        );
      }

      await tx.bus.delete({ where: { id: bus.id } });
      return { deleted: true };
    });
  }

  // ----- routes -----

  async listRoutes(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      return tx.transportRoute.findMany({
        where: { tenantId },
        include: {
          bus: true,
          _count: { select: { stops: true, assignments: true, trips: true } },
        },
        orderBy: { name: 'asc' },
      });
    });
  }

  async createRoute(tenantId: string, dto: CreateRouteDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (dto.busId) {
        const bus = await tx.bus.findFirst({
          where: { id: dto.busId, tenantId },
          select: { id: true },
        });
        if (!bus) throw new NotFoundException('Bus not found');
      }
      const dup = await tx.transportRoute.findFirst({
        where: { tenantId, name: { equals: dto.name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (dup)
        throw new ConflictException('A route with this name already exists');

      return tx.transportRoute.create({
        data: {
          tenantId,
          name: dto.name.trim(),
          shift: dto.shift as TransportShift,
          ...(dto.busId ? { busId: dto.busId } : {}),
        },
      });
    });
  }

  async updateRoute(tenantId: string, id: string, dto: UpdateRouteDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const route = await tx.transportRoute.findFirst({
        where: { id, tenantId },
      });
      if (!route) throw new NotFoundException('Route not found');

      const data: any = {};
      if (dto.name !== undefined) {
        if (dto.name.toLowerCase() !== route.name.toLowerCase()) {
          const dup = await tx.transportRoute.findFirst({
            where: {
              tenantId,
              name: { equals: dto.name, mode: 'insensitive' },
            },
            select: { id: true },
          });
          if (dup)
            throw new ConflictException(
              'A route with this name already exists',
            );
        }
        data.name = dto.name.trim();
      }
      if (dto.shift !== undefined) data.shift = dto.shift;
      if (dto.busId !== undefined) {
        if (dto.busId === null) {
          data.busId = null;
        } else {
          const bus = await tx.bus.findFirst({
            where: { id: dto.busId, tenantId },
            select: { id: true },
          });
          if (!bus) throw new NotFoundException('Bus not found');
          data.busId = dto.busId;
        }
      }
      return tx.transportRoute.update({ where: { id: route.id }, data });
    });
  }

  async deleteRoute(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const route = await tx.transportRoute.findFirst({
        where: { id, tenantId },
      });
      if (!route) throw new NotFoundException('Route not found');

      const assignmentCount = await tx.transportAssignment.count({
        where: { tenantId, routeId: id },
      });
      if (assignmentCount > 0) {
        throw new ConflictException(
          'Students are still assigned to this route; unassign them first',
        );
      }

      // Stepwise child cleanup. A bare route delete relies on the DB's
      // cascades, which the Neon driver reports as a misleading P2011
      // ("null constraint violation"); deleting children explicitly keeps
      // the transaction deterministic about row order.
      await tx.transportTripEvent.deleteMany({
        where: { trip: { routeId: route.id, tenantId } },
      });
      await tx.transportTrip.deleteMany({
        where: { routeId: route.id, tenantId },
      });
      await tx.routeStop.deleteMany({
        where: { routeId: route.id, tenantId },
      });

      await tx.transportRoute.delete({ where: { id: route.id } });
      return { deleted: true };
    });
  }

  // ----- stops -----

  async getStops(tenantId: string, routeId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const route = await tx.transportRoute.findFirst({
        where: { id: routeId, tenantId },
        select: { id: true },
      });
      if (!route) throw new NotFoundException('Route not found');
      return tx.routeStop.findMany({
        where: { routeId: route.id },
        orderBy: { sequence: 'asc' },
      });
    });
  }

  async replaceStops(tenantId: string, routeId: string, dto: ReplaceStopsDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const route = await tx.transportRoute.findFirst({
        where: { id: routeId, tenantId },
        select: { id: true },
      });
      if (!route) throw new NotFoundException('Route not found');

      const stops = dto.stops;
      for (const stop of stops) {
        const name = stop.name.trim();
        if (!name) throw new BadRequestException('Stop name is required');
        if (stop.morningEta && !ETA_PATTERN.test(stop.morningEta)) {
          throw new BadRequestException(
            `Invalid morning ETA '${stop.morningEta}' — use HH:MM (24h)`,
          );
        }
        if (stop.eveningEta && !ETA_PATTERN.test(stop.eveningEta)) {
          throw new BadRequestException(
            `Invalid evening ETA '${stop.eveningEta}' — use HH:MM (24h)`,
          );
        }
      }
      const seen = new Set<number>();
      for (const stop of stops) {
        if (seen.has(stop.sequence)) {
          throw new BadRequestException(
            `Duplicate stop sequence ${stop.sequence}`,
          );
        }
        seen.add(stop.sequence);
      }
      const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
      ordered.forEach((stop, i) => {
        if (stop.sequence !== i + 1) {
          throw new BadRequestException(
            `Stop sequences must be consecutive starting at 1 (bad '${stop.name}')`,
          );
        }
      });

      await tx.routeStop.deleteMany({ where: { routeId: route.id } });
      if (ordered.length > 0) {
        await tx.routeStop.createMany({
          data: ordered.map((s) => ({
            tenantId,
            routeId: route.id,
            name: s.name.trim(),
            sequence: s.sequence,
            morningEta: s.morningEta ?? null,
            eveningEta: s.eveningEta ?? null,
          })),
        });
      }

      return tx.routeStop.findMany({
        where: { routeId: route.id },
        orderBy: { sequence: 'asc' },
      });
    });
  }

  // ----- assignments / manifest -----

  async listTransportStudents(tenantId: string, query: TransportListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const search = query.search?.trim();
    const routeId = (query as any).routeId;
    const busId = (query as any).busId;

    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const where: any = {
        tenantId,
        ...(routeId ? { routeId } : busId ? { route: { busId } } : {}),
        ...(search
          ? {
              student: {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { middleName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } },
                  { roleNumber: { contains: search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      };

      const [assignments, total] = await Promise.all([
        tx.transportAssignment.findMany({
          where,
          include: {
            student: {
              select: {
                id: true,
                firstName: true,
                middleName: true,
                lastName: true,
                roleNumber: true,
              },
            },
            route: { select: { id: true, name: true, shift: true } },
            stop: {
              select: {
                id: true,
                name: true,
                morningEta: true,
                eveningEta: true,
              },
            },
          },
          orderBy: { id: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.transportAssignment.count({ where }),
      ]);

      const studentIds = assignments.map((a) => a.student.id);
      const [enrollments, feeStatuses] = await Promise.all([
        studentIds.length
          ? tx.studentEnrollment.findMany({
              where: { tenantId, studentId: { in: studentIds } },
              orderBy: { enrolledOn: 'desc' },
              select: {
                studentId: true,
                schoolClass: { select: { className: true } },
              },
            })
          : Promise.resolve([] as any[]),
        studentIds.length
          ? this.finance.getTransportFeeStatus(tenantId, studentIds)
          : Promise.resolve([] as any[]),
      ]);

      const classByStudent = new Map<string, string>();
      for (const e of enrollments) {
        if (!classByStudent.has(e.studentId)) {
          classByStudent.set(e.studentId, e.schoolClass.className);
        }
      }
      const feeByStudent = new Map<string, any>();
      for (const f of feeStatuses) {
        feeByStudent.set(f.studentId, f);
      }

      return {
        data: assignments.map((a) => {
          const fee = feeByStudent.get(a.student.id);
          return {
            assignmentId: a.id,
            studentId: a.student.id,
            studentName: fullName(a.student),
            roleNumber: a.student.roleNumber,
            className: classByStudent.get(a.student.id) ?? null,
            routeId: a.route.id,
            routeName: a.route.name,
            shift: a.route.shift,
            stopId: a.stop?.id ?? null,
            stopName: a.stop?.name ?? null,
            transportFee: fee?.transportFee ?? 0,
            transportPaid: fee?.transportPaid ?? 0,
            feeStatus: fee?.status ?? 'NOT_BILLED',
          };
        }),
        total,
        page,
        limit,
      };
    });
  }

  async listAssignableStudents(tenantId: string, query: TransportListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const search = query.search?.trim();

    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const where: any = {
        tenantId,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { middleName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { roleNumber: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const [students, total] = await Promise.all([
        tx.student.findMany({
          where,
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            roleNumber: true,
          },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.student.count({ where }),
      ]);

      const ids = students.map((s: any) => s.id);
      const assignments = ids.length
        ? await tx.transportAssignment.findMany({
            where: { tenantId, studentId: { in: ids } },
            include: {
              route: { select: { id: true, name: true } },
              stop: { select: { id: true, name: true } },
            },
          })
        : [];
      const byStudent = new Map<string, any>();
      for (const a of assignments) byStudent.set(a.studentId, a);

      return {
        data: students.map((s: any) => {
          const a = byStudent.get(s.id);
          return {
            id: s.id,
            firstName: s.firstName,
            middleName: s.middleName,
            lastName: s.lastName,
            roleNumber: s.roleNumber,
            fullName: fullName(s),
            assignment: a
              ? {
                  routeId: a.route.id,
                  routeName: a.route.name,
                  stopId: a.stop?.id ?? null,
                  stopName: a.stop?.name ?? null,
                }
              : null,
          };
        }),
        total,
        page,
        limit,
      };
    });
  }

  private async resolveAssignTarget(
    tx: any,
    tenantId: string,
    routeId: string,
    stopId?: string,
  ) {
    const route = await tx.transportRoute.findFirst({
      where: { id: routeId, tenantId },
      select: { id: true, name: true },
    });
    if (!route) throw new NotFoundException('Route not found');

    if (!stopId) return { route, stopId: null as string | null };

    const stop = await tx.routeStop.findFirst({
      where: { id: stopId, tenantId },
      select: { id: true, routeId: true, name: true },
    });
    if (!stop) throw new NotFoundException('Stop not found');
    if (stop.routeId !== route.id) {
      throw new BadRequestException(
        `Stop '${stop.name}' is not on route '${route.name}'`,
      );
    }
    return { route, stopId: stop.id };
  }

  private async upsertAssignment(
    tx: any,
    tenantId: string,
    studentId: string,
    routeId: string,
    stopId: string | null,
  ) {
    const existing = await tx.transportAssignment.findFirst({
      where: { tenantId, studentId },
      select: { id: true },
    });
    if (existing) {
      return tx.transportAssignment.update({
        where: { id: existing.id },
        data: { routeId, stopId },
        include: {
          route: { select: { id: true, name: true, shift: true } },
          stop: { select: { id: true, name: true } },
        },
      });
    }
    return tx.transportAssignment.create({
      data: { tenantId, studentId, routeId, stopId },
      include: {
        route: { select: { id: true, name: true, shift: true } },
        stop: { select: { id: true, name: true } },
      },
    });
  }

  async assignStudent(tenantId: string, dto: AssignStudentDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: dto.studentId, tenantId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!student) throw new NotFoundException('Student not found');

      const { route, stopId } = await this.resolveAssignTarget(
        tx,
        tenantId,
        dto.routeId,
        dto.stopId,
      );

      const saved = await this.upsertAssignment(
        tx,
        tenantId,
        student.id,
        route.id,
        stopId,
      );

      if (dto.transportFee !== undefined) {
        await this.finance.setStudentTransportFee(
          tenantId,
          student.id,
          dto.transportFee,
        );
      }

      return saved;
    });
  }

  async assignStudentsBatch(tenantId: string, dto: AssignStudentsBatchDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (!dto.studentIds.length) {
        throw new BadRequestException('Select at least one student');
      }
      if (new Set(dto.studentIds).size !== dto.studentIds.length) {
        throw new BadRequestException(
          'Duplicate students in the selection',
        );
      }

      const { route, stopId } = await this.resolveAssignTarget(
        tx,
        tenantId,
        dto.routeId,
        dto.stopId,
      );

      const found = await tx.student.findMany({
        where: { tenantId, id: { in: dto.studentIds } },
        select: { id: true },
      });
      if (found.length !== dto.studentIds.length) {
        throw new NotFoundException('One or more selected students were not found');
      }

      for (const studentId of dto.studentIds) {
        await this.upsertAssignment(tx, tenantId, studentId, route.id, stopId);
      }

      if (dto.transportFee !== undefined) {
        for (const studentId of dto.studentIds) {
          await this.finance.setStudentTransportFee(
            tenantId,
            studentId,
            dto.transportFee,
          );
        }
      }

      return { assigned: dto.studentIds.length };
    });
  }

  async unassignStudent(tenantId: string, studentId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const assignment = await tx.transportAssignment.findFirst({
        where: { tenantId, studentId },
        select: { id: true },
      });
      if (!assignment)
        throw new NotFoundException('This student has no transport assignment');

      await tx.transportAssignment.delete({ where: { id: assignment.id } });
      await this.finance.setStudentTransportFee(tenantId, studentId, 0);
      return { unassigned: true };
    });
  }

  // ----- trips -----

  /**
   * Guardians of every student currently assigned to a route. Resolved from
   * live assignments at emit time, so a mid-trip unassignment stops pushing
   * that family immediately without any persistence on the trip.
   */
  private async routeGuardianUserIds(
    tenantId: string,
    tx: any,
    routeId: string,
  ): Promise<string[]> {
    const assignments = await tx.transportAssignment.findMany({
      where: { tenantId, routeId },
      include: {
        student: {
          include: {
            guardians: { include: { guardian: { select: { userId: true } } } },
          },
        },
      },
    });
    const userIds = new Set<string>();
    for (const link of assignments) {
      for (const guardianLink of link.student.guardians) {
        if (guardianLink.guardian.userId)
          userIds.add(guardianLink.guardian.userId);
      }
    }
    return [...userIds];
  }

  /**
   * One Notification row per guardian + the guardian user rooms to push to.
   * The room list is derived in the same pass so an emit can never reach a
   * guardian whose row was never written (the DB row is the receipt; the
   * socket is the nudge).
   */
  private async notifyRouteGuardians(
    tenantId: string,
    tx: any,
    routeId: string,
    title: string,
    body: string,
  ): Promise<string[]> {
    const userIds = await this.routeGuardianUserIds(tenantId, tx, routeId);
    for (const userId of userIds) {
      await tx.notification.create({
        data: {
          tenantId,
          userId,
          type: 'TRANSPORT_TRIP',
          title,
          body,
          channel: NotificationChannel.IN_APP,
        },
      });
    }
    return userIds.flatMap((userId) => roomsForTarget('STUDENT', userId));
  }

  async startTrip(tenantId: string, routeId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const route = await tx.transportRoute.findFirst({
        where: { id: routeId, tenantId },
        select: { id: true, name: true },
      });
      if (!route) throw new NotFoundException('Route not found');

      const inProgress = await tx.transportTrip.findFirst({
        where: { tenantId, routeId: route.id, status: 'IN_PROGRESS' },
        select: { id: true },
      });
      if (inProgress)
        throw new ConflictException(
          'A trip is already in progress for this route',
        );

      const now = new Date();
      const tripDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );

      const trip = await tx.transportTrip.create({
        data: {
          tenantId,
          routeId: route.id,
          tripDate,
          status: 'IN_PROGRESS' as never,
        },
      });

      const rooms = await this.notifyRouteGuardians(
        tenantId,
        tx,
        route.id,
        'Bus trip started',
        `The bus on route '${route.name}' has started.`,
      );
      await this.realtime.emitDomainEvent({
        kind: 'bus_trip_started',
        rooms,
        payload: { tripId: trip.id, routeId: route.id, routeName: route.name },
      });

      return { ...trip, events: [] };
    });
  }

  async getTrip(tenantId: string, tripId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const trip = await tx.transportTrip.findFirst({
        where: { id: tripId, tenantId },
        include: {
          route: {
            select: {
              id: true,
              name: true,
              shift: true,
              bus: {
                select: { id: true, plateNumber: true, driverName: true },
              },
            },
          },
          events: {
            orderBy: { at: 'asc' },
            include: {
              stop: { select: { id: true, name: true, sequence: true } },
            },
          },
        },
      });
      if (!trip) throw new NotFoundException('Trip not found');
      return trip;
    });
  }

  async recordArrival(tenantId: string, tripId: string, stopId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const trip = await tx.transportTrip.findFirst({
        where: { id: tripId, tenantId },
        include: { route: { select: { id: true, name: true } } },
      });
      if (!trip) throw new NotFoundException('Trip not found');
      if (trip.status !== 'IN_PROGRESS') {
        throw new BadRequestException('Trip is not in progress');
      }

      const stop = await tx.routeStop.findFirst({
        where: { id: stopId, tenantId },
        select: { id: true, name: true, routeId: true },
      });
      if (!stop || stop.routeId !== trip.routeId) {
        throw new BadRequestException('Stop is not on this trip route');
      }

      const seen = await tx.transportTripEvent.findFirst({
        where: {
          tenantId,
          tripId: trip.id,
          stopId: stop.id,
          type: 'ARRIVED_STOP' as never,
        },
        select: { id: true },
      });
      if (seen)
        throw new ConflictException(
          `Arrival at '${stop.name}' was already reported`,
        );

      const event = await tx.transportTripEvent.create({
        data: {
          tenantId,
          tripId: trip.id,
          stopId: stop.id,
          type: 'ARRIVED_STOP' as never,
        },
      });

      const rooms = await this.notifyRouteGuardians(
        tenantId,
        tx,
        trip.routeId,
        `Bus arrival — ${stop.name}`,
        `The bus on route '${trip.route.name}' has reached '${stop.name}'.`,
      );
      await this.realtime.emitDomainEvent({
        kind: 'bus_arrived_stop',
        rooms,
        payload: {
          tripId: trip.id,
          routeId: trip.routeId,
          routeName: trip.route.name,
          stopId: stop.id,
          stopName: stop.name,
        },
      });

      return event;
    });
  }

  async completeTrip(tenantId: string, tripId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const trip = await tx.transportTrip.findFirst({
        where: { id: tripId, tenantId },
        include: { route: { select: { id: true, name: true } } },
      });
      if (!trip) throw new NotFoundException('Trip not found');
      if (trip.status === 'COMPLETED')
        throw new BadRequestException('Trip is already completed');

      return tx.transportTrip.update({
        where: { id: trip.id },
        data: { status: 'COMPLETED' as never, completedAt: new Date() },
      });
    });
  }

  async listTrips(tenantId: string, routeId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const route = await tx.transportRoute.findFirst({
        where: { id: routeId, tenantId },
        select: { id: true },
      });
      if (!route) throw new NotFoundException('Route not found');

      return tx.transportTrip.findMany({
        where: { tenantId, routeId: route.id },
        orderBy: { startedAt: 'desc' },
        take: 30,
        include: {
          events: {
            orderBy: { at: 'asc' },
            include: {
              stop: { select: { id: true, name: true, sequence: true } },
            },
          },
        },
      });
    });
  }
}
