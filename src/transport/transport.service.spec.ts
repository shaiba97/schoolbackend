import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TransportService } from './transport.service';

const TENANT = 'tenant-1';

function eqInsensitive(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

function tripsOf(o: any): any[] {
  const routes = o.routes ?? [];
  const events = o.events ?? [];
  return (o.trips ?? []).map((t: any) => ({
    status: 'IN_PROGRESS',
    route: routes.find((r: any) => r.id === t.routeId) ?? null,
    events: events.filter((e: any) => e.tripId === t.id),
    ...t,
  }));
}

// narrow prisma-where resolver covering the where shapes the service issues
function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  if (where.id !== undefined && row.id !== where.id) return false;
  if (
    where.tenantId !== undefined &&
    where.tenantId !== TENANT &&
    row.tenantId !== undefined
  )
    return false;
  const plate = where.plateNumber;
  if (
    plate?.equals !== undefined &&
    !eqInsensitive(row.plateNumber ?? '', plate.equals)
  )
    return false;
  const name = where.name;
  if (name?.equals !== undefined && !eqInsensitive(row.name ?? '', name.equals))
    return false;
  return true;
}

// student where resolver: id/in, tenantId (soft), and search OR contains-insensitive
function studentMatches(s: any, where: any): boolean {
  if (!where) return true;
  if (
    where.tenantId !== undefined &&
    s.tenantId !== undefined &&
    s.tenantId !== where.tenantId
  )
    return false;
  if (where.id?.in) {
    if (!where.id.in.includes(s.id)) return false;
  }
  if (where.id !== undefined && typeof where.id === 'string') {
    if (s.id !== where.id) return false;
  }
  if (where.OR) {
    const hit = where.OR.some((c: any) =>
      Object.entries(c).some(([field, cond]: any) => {
        const v = cond?.contains;
        if (v === undefined) return false;
        return String(s[field] ?? '')
          .toLowerCase()
          .includes(String(v).toLowerCase());
      }),
    );
    if (!hit) return false;
  }
  return true;
}

function makeTx(o: any = {}) {
  const buses = o.buses ?? [];
  const routes = o.routes ?? [];
  const stops = o.stops ?? [];
  const students = o.students ?? [];
  const tx: any = {
    bus: {
      findMany: jest.fn(async (args: any = {}) => {
        const rows = buses.filter((b: any) => matchWhere(b, args.where));
        const skip = args.skip ?? 0;
        const take = args.take ?? rows.length;
        return rows.slice(skip, skip + take);
      }),
      findFirst: jest.fn(async (args: any = {}) => {
        const bus = buses.find((b: any) => matchWhere(b, args.where)) ?? null;
        if (bus && args.include?.routes) {
          const busRoutes = routes
            .filter((r: any) => r.busId === bus.id)
            .sort((a: any, b: any) =>
              String(a.name ?? '').localeCompare(String(b.name ?? '')),
            )
            .map((r: any) => ({
              ...r,
              _count: {
                stops: stops.filter((s: any) => s.routeId === r.id).length,
                assignments: (o.assignments ?? []).filter(
                  (a: any) => a.routeId === r.id,
                ).length,
              },
            }));
          return { ...bus, routes: busRoutes };
        }
        return bus;
      }),
      findUnique: jest.fn(
        async (args: any) =>
          buses.find((b: any) => b.id === args?.where?.id) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => ({
        id: 'bus-new',
        tenantId: TENANT,
        ...data,
      })),
      update: jest.fn(async ({ where, data }: any) => ({
        ...buses.find((b: any) => b.id === where.id),
        id: where.id,
        ...data,
      })),
      delete: jest.fn(async () => null),
      count: jest.fn(
        async (args: any) =>
          buses.filter((b: any) => matchWhere(b, args?.where)).length,
      ),
    },
    transportRoute: {
      findMany: jest.fn(async () => routes),
      findFirst: jest.fn(
        async (args: any) =>
          routes.find((r: any) => matchWhere(r, args.where)) ?? null,
      ),
      findUnique: jest.fn(async () => o.routeByUnique ?? null),
      create: jest.fn(async ({ data }: any) => ({
        id: 'route-new',
        tenantId: TENANT,
        busId: null,
        ...data,
      })),
      update: jest.fn(async ({ where, data }: any) => ({
        ...routes.find((r: any) => r.id === where.id),
        id: where.id,
        ...data,
      })),
      delete: jest.fn(async () => null),
      count: jest.fn(async () => routes.length),
    },
    routeStop: {
      findMany: jest.fn(async () =>
        [...stops].sort((a: any, b: any) => a.sequence - b.sequence),
      ),
      findFirst: jest.fn(async (args: any) => {
        const s = stops.find((x: any) => matchWhere(x, args.where)) ?? null;
        return s;
      }),
      createMany: jest.fn(async () => null),
      deleteMany: jest.fn(async () => null),
    },
    transportAssignment: {
      findMany: jest.fn(async (args: any = {}) => {
        let rows: any[] = o.assignments ?? [];
        const w = args?.where;
        if (w?.studentId?.in) {
          rows = rows.filter((a: any) => w.studentId.in.includes(a.studentId));
        }
        if (
          w?.studentId !== undefined &&
          typeof w.studentId === 'string'
        ) {
          rows = rows.filter((a: any) => a.studentId === w.studentId);
        }
        if (w?.tenantId !== undefined) {
          rows = rows.filter(
            (a: any) => a.tenantId === undefined || a.tenantId === w.tenantId,
          );
        }
        if (args?.include?.route && rows.length) {
          rows = rows.map((a: any) => ({
            ...a,
            route:
              a.route ?? routes.find((r: any) => r.id === a.routeId) ?? null,
            stop: a.stop ?? stops.find((s: any) => s.id === a.stopId) ?? null,
          }));
        }
        return rows;
      }),
      findFirst: jest.fn(async (args: any) => {
        if (o.assignmentByStudent) return o.assignmentByStudent(args) ?? null;
        return (
          (o.assignments ?? []).find(
            (a: any) => a.studentId === args?.where?.studentId,
          ) ?? null
        );
      }),
      count: jest.fn(async (args: any) =>
        args?.where?.routeId
          ? (o.assignments ?? []).filter(
              (a: any) => a.routeId === args.where.routeId,
            ).length
          : (o.assignments ?? []).length,
      ),
      create: jest.fn(async ({ data }: any) => ({
        id: 'assign-new',
        tenantId: TENANT,
        stopId: null,
        ...data,
      })),
      update: jest.fn(async ({ where, data }: any) => ({
        ...(o.assignments ?? []).find((a: any) => a.id === where.id),
        id: where.id,
        ...data,
      })),
      delete: jest.fn(async () => null),
      deleteMany: jest.fn(async () => null),
    },
    transportTrip: {
      findMany: jest.fn(async () => o.trips ?? []),
      findFirst: jest.fn(async (args: any) => tripsOf(o).find((t: any) => matchWhere(t, args.where)) ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 'trip-new', tenantId: TENANT, tripDate: new Date(), ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ ...tripsOf(o).find((t: any) => t.id === where.id), id: where.id, ...data })),
      count: jest.fn(async () => (o.trips ?? []).length),
      deleteMany: jest.fn(async () => null),
    },
    transportTripEvent: {
      findMany: jest.fn(async () => o.events ?? []),
      findFirst: jest.fn(async (args: any) => (o.events ?? []).find((e: any) => matchWhere(e, args.where)) ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 'event-new', tenantId: TENANT, at: new Date(), ...data })),
      count: jest.fn(async () => (o.events ?? []).length),
      deleteMany: jest.fn(async () => null),
    },
    notification: {
      create: jest.fn(async ({ data }: any) => ({ id: 'notif-new', ...data })),
    },
    student: {
      findFirst: jest.fn(
        async (args: any) =>
          students.find((s: any) => s.id === args?.where?.id) ?? null,
      ),
      findMany: jest.fn(async (args: any = {}) => {
        const filtered = students
          .filter((s: any) => studentMatches(s, args.where))
          .sort(
            (a: any, b: any) =>
              String(a.firstName ?? '').localeCompare(String(b.firstName ?? '')) ||
              String(a.lastName ?? '').localeCompare(String(b.lastName ?? '')),
          );
        const skip = args.skip ?? 0;
        const take = args.take ?? filtered.length;
        return filtered.slice(skip, skip + take);
      }),
      count: jest.fn(
        async (args: any = {}) =>
          students.filter((s: any) => studentMatches(s, args.where)).length,
      ),
      findUnique: jest.fn(
        async (args: any) =>
          students.find((s: any) => s.id === args?.where?.id) ?? null,
      ),
    },
    studentEnrollment: {
      findMany: jest.fn(async (args: any) =>
        (o.enrollments ?? []).filter(
          (e: any) => args?.where?.studentId?.in?.includes(e.studentId) ?? true,
        ),
      ),
    },
  };
  return tx;
}

function makeService(
  tx: any,
  finance: any = {
    setStudentTransportFee: jest.fn(async () => ({})),
    getTransportFeeStatus: jest.fn(async () => []),
  },
  realtime: any = { emitDomainEvent: jest.fn(async () => undefined) },
) {
  const prisma: any = {
    withTenant: async (_t: string, cb: any) => cb(tx),
    withTenantRead: async (_t: string, cb: any) => cb(tx),
  };
  return { svc: new TransportService(prisma, finance, realtime), finance, realtime };
}

describe('vehicles', () => {
  it('lists vehicles paginated with data/total/page/limit', async () => {
    const buses = Array.from({ length: 3 }, (_, i) => ({
      id: `bus-${i}`,
      plateNumber: `PL-${i}`,
    }));
    const { svc } = makeService(makeTx({ buses }));
    const res: any = await svc.listVehicles(TENANT, { page: 2, limit: 2 });
    expect(res.total).toBe(3);
    expect(res.page).toBe(2);
    expect(res.limit).toBe(2);
    expect(res.data).toHaveLength(1); // 3 rows total → page 2 holds the last row
  });

  it('creates a vehicle with driver details', async () => {
    const tx = makeTx();
    const { svc } = makeService(tx);
    const res: any = await svc.createVehicle(TENANT, {
      plateNumber: 'SD 1234',
      model: 'Toyota Hiace 2024',
      capacity: 18,
      driverName: 'Not Given Ahmed',
      driverPhone: '0912345678',
      driverLicenseNumber: 'LIC-12345',
      driverEmergencyContact: 'Wife, 0998887776',
    });
    expect(res.id).toBe('bus-new');
    expect(tx.bus.create).toHaveBeenCalled();
  });

  it('rejects a duplicate plate number', async () => {
    const tx = makeTx({
      buses: [{ id: 'bus-1', plateNumber: 'SD 1234', status: 'ACTIVE' }],
    });
    const { svc } = makeService(tx);
    await expect(
      svc.createVehicle(TENANT, {
        plateNumber: 'SD 1234',
        model: 'X',
        capacity: 10,
        driverName: 'D',
        driverPhone: '0911',
        driverLicenseNumber: 'LIC',
        driverEmergencyContact: 'EC',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates a vehicle partially', async () => {
    const tx = makeTx({
      buses: [
        {
          id: 'bus-1',
          plateNumber: 'PL-1',
          driverName: 'Old',
          status: 'ACTIVE',
        },
      ],
    });
    const { svc } = makeService(tx);
    const res: any = await svc.updateVehicle(TENANT, 'bus-1', {
      status: 'MAINTENANCE',
    });
    expect(res.status).toBe('MAINTENANCE');
    expect(res.plateNumber).toBe('PL-1');
  });

  it('rejects vehicle deletion while a route still uses it', async () => {
    const tx = makeTx({
      buses: [{ id: 'bus-1', plateNumber: 'PL-1' }],
      routes: [{ id: 'route-1', busId: 'bus-1' }],
    });
    const { svc } = makeService(tx);
    await expect(svc.deleteVehicle(TENANT, 'bus-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.bus.delete).not.toHaveBeenCalled();
  });
});

describe('routes and stops', () => {
  it('creates a route with an assigned bus', async () => {
    const tx = makeTx({ buses: [{ id: 'bus-1', plateNumber: 'PL-1' }] });
    const { svc } = makeService(tx);
    const res: any = await svc.createRoute(TENANT, {
      name: 'El Omda North',
      shift: 'BOTH',
      busId: 'bus-1',
    });
    expect(res.id).toBe('route-new');
  });

  it('rejects a route with an unknown bus', async () => {
    const { svc } = makeService(makeTx());
    await expect(
      svc.createRoute(TENANT, { name: 'X', shift: 'MORNING', busId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a duplicate route name', async () => {
    const tx = makeTx({
      routes: [{ id: 'route-1', name: 'El Omda North', shift: 'BOTH' }],
    });
    const { svc } = makeService(tx);
    await expect(
      svc.createRoute(TENANT, { name: 'El Omda North', shift: 'BOTH' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects route deletion while students are assigned to it', async () => {
    const tx = makeTx({
      routes: [{ id: 'route-1', name: 'A', shift: 'BOTH' }],
      assignments: [
        { id: 'assign-1', studentId: 'student-1', routeId: 'route-1' },
      ],
    });
    const { svc } = makeService(tx);
    await expect(svc.deleteRoute(TENANT, 'route-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.transportRoute.delete).not.toHaveBeenCalled();
  });

  it('cleans up trips, events, and stops stepwise before deleting the route', async () => {
    const tx = makeTx({
      routes: [{ id: 'route-1', name: 'A', shift: 'BOTH' }],
    });
    const { svc } = makeService(tx);
    await svc.deleteRoute(TENANT, 'route-1');
    expect(tx.transportTripEvent.deleteMany).toHaveBeenCalledWith({
      where: { trip: { routeId: 'route-1', tenantId: TENANT } },
    });
    expect(tx.transportTrip.deleteMany).toHaveBeenCalledWith({
      where: { routeId: 'route-1', tenantId: TENANT },
    });
    expect(tx.routeStop.deleteMany).toHaveBeenCalledWith({
      where: { routeId: 'route-1', tenantId: TENANT },
    });
    expect(tx.transportRoute.delete).toHaveBeenCalledWith({
      where: { id: 'route-1' },
    });
    const ev = tx.transportTripEvent.deleteMany.mock.invocationCallOrder[0];
    const trp = tx.transportTrip.deleteMany.mock.invocationCallOrder[0];
    const stp = tx.routeStop.deleteMany.mock.invocationCallOrder[0];
    const rte = tx.transportRoute.delete.mock.invocationCallOrder[0];
    expect(ev).toBeLessThan(trp);
    expect(trp).toBeLessThan(stp);
    expect(stp).toBeLessThan(rte);
  });

  it('replaces stops wholesale with validated ordering', async () => {
    const tx = makeTx({
      routes: [{ id: 'route-1', name: 'A', shift: 'BOTH' }],
    });
    const { svc } = makeService(tx);
    await svc.replaceStops(TENANT, 'route-1', {
      stops: [
        { name: 'Gate', sequence: 1, morningEta: '07:10' },
        { name: 'Market', sequence: 2, morningEta: '07:25' },
      ],
    });
    expect(tx.routeStop.deleteMany).toHaveBeenCalled();
    expect(tx.routeStop.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          name: 'Gate',
          sequence: 1,
          routeId: 'route-1',
        }),
        expect.objectContaining({
          name: 'Market',
          sequence: 2,
          routeId: 'route-1',
        }),
      ],
    });
  });

  it('rejects invalid sequence or ETA formats', async () => {
    const tx = makeTx({
      routes: [{ id: 'route-1', name: 'A', shift: 'BOTH' }],
    });
    const { svc } = makeService(tx);
    await expect(
      svc.replaceStops(TENANT, 'route-1', {
        stops: [{ name: 'A', sequence: 2 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.replaceStops(TENANT, 'route-1', {
        stops: [{ name: 'A', sequence: 1, morningEta: '7:0x' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists stops ordered by sequence', async () => {
    const tx = makeTx({
      routes: [{ id: 'route-1', name: 'A', shift: 'BOTH' }],
      stops: [
        { id: 's2', routeId: 'route-1', name: 'B', sequence: 2 },
        { id: 's1', routeId: 'route-1', name: 'A', sequence: 1 },
      ],
    });
    const { svc } = makeService(tx);
    const res: any = await svc.getStops(TENANT, 'route-1');
    expect(res.map((s: any) => s.sequence)).toEqual([1, 2]);
  });
});

describe('assignments and manifest', () => {
  const student = {
    id: 'student-1',
    firstName: 'Amina',
    lastName: 'Khalid',
    roleNumber: '2026-001',
  };

  it('assigns a student, syncing the transport fee through finance', async () => {
    const tx = makeTx({
      routes: [{ id: 'route-1', name: 'A', shift: 'BOTH' }],
      stops: [{ id: 'stop-1', routeId: 'route-1', name: 'Gate', sequence: 1 }],
      students: [student],
    });
    const finance: any = { setStudentTransportFee: jest.fn(async () => ({})) };
    const { svc } = makeService(tx, finance);
    const res: any = await svc.assignStudent(TENANT, {
      studentId: 'student-1',
      routeId: 'route-1',
      stopId: 'stop-1',
      transportFee: 250000,
    });
    expect(tx.transportAssignment.create).toHaveBeenCalled();
    expect(finance.setStudentTransportFee).toHaveBeenCalledWith(
      TENANT,
      'student-1',
      250000,
    );
    expect(res.id).toBe('assign-new');
  });

  it('rejects a stop outside the assigned route', async () => {
    const tx = makeTx({
      routes: [{ id: 'route-1', name: 'A', shift: 'BOTH' }],
      stops: [
        { id: 'stop-9', routeId: 'route-9', name: 'Elsewhere', sequence: 1 },
      ],
      students: [student],
    });
    const { svc } = makeService(tx);
    await expect(
      svc.assignStudent(TENANT, {
        studentId: 'student-1',
        routeId: 'route-1',
        stopId: 'stop-9',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects assigning to an unknown student', async () => {
    const { svc } = makeService(makeTx({ routes: [{ id: 'route-1' }] }));
    await expect(
      svc.assignStudent(TENANT, { studentId: 'ghost', routeId: 'route-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('re-assigns via the upsert-one-per-student rule', async () => {
    const tx = makeTx({
      routes: [{ id: 'route-1', name: 'A', shift: 'BOTH' }],
      assignments: [
        { id: 'assign-1', studentId: 'student-1', routeId: 'route-1' },
      ],
      students: [student],
    });
    const finance: any = { setStudentTransportFee: jest.fn(async () => ({})) };
    const { svc } = makeService(tx, finance);
    const res: any = await svc.assignStudent(TENANT, {
      studentId: 'student-1',
      routeId: 'route-1',
      transportFee: 100000,
    });
    // create never called again — the existing row is the slot that updates.
    expect(tx.transportAssignment.create).not.toHaveBeenCalled();
    expect(tx.transportAssignment.update).toHaveBeenCalled();
    expect(finance.setStudentTransportFee).toHaveBeenCalledWith(
      TENANT,
      'student-1',
      100000,
    );
    expect(res.id).toBe('assign-1');
  });

  it('unassigns a student and clears their transport fee', async () => {
    const tx = makeTx({
      students: [student],
      assignments: [
        { id: 'assign-1', studentId: 'student-1', routeId: 'route-1' },
      ],
    });
    const finance: any = { setStudentTransportFee: jest.fn(async () => ({})) };
    const { svc } = makeService(tx, finance);
    await svc.unassignStudent(TENANT, 'student-1');
    expect(tx.transportAssignment.delete).toHaveBeenCalled();
    expect(finance.setStudentTransportFee).toHaveBeenCalledWith(
      TENANT,
      'student-1',
      0,
    );
  });

  it('rejects unassigning a student who has no assignment', async () => {
    const { svc } = makeService(makeTx({ students: [student] }));
    await expect(
      svc.unassignStudent(TENANT, 'student-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists the manifest with route, stop, class and fee status', async () => {
    const tx = makeTx({
      assignments: [
        {
          id: 'assign-1',
          studentId: 'student-1',
          routeId: 'route-1',
          student,
          route: { id: 'route-1', name: 'El Omda North' },
          stop: { id: 'stop-1', name: 'Gate' },
        },
      ],
      assignmentsCount: undefined,
    });
    tx.transportAssignment.findMany = jest.fn(async () => [
      {
        id: 'assign-1',
        studentId: 'student-1',
        routeId: 'route-1',
        student,
        route: { id: 'route-1', name: 'El Omda North' },
        stop: { id: 'stop-1', name: 'Gate' },
      },
    ]);
    tx.studentEnrollment = {
      findMany: jest.fn(async () => [
        { studentId: 'student-1', schoolClass: { className: 'Secondary 1B' } },
      ]),
    };
    const finance: any = {
      getTransportFeeStatus: jest.fn(async () => [
        {
          studentId: 'student-1',
          transportFee: 250000,
          transportPaid: 250000,
          status: 'PAID',
        },
      ]),
    };
    const { svc } = makeService(tx, finance);
    const res: any = await svc.listTransportStudents(TENANT, {
      page: 1,
      limit: 50,
    });
    expect(res.total).toBe(1);
    expect(res.data[0]).toMatchObject({
      studentId: 'student-1',
      studentName: 'Amina Khalid',
      className: 'Secondary 1B',
      routeName: 'El Omda North',
      stopName: 'Gate',
      feeStatus: 'PAID',
    });
    expect(finance.getTransportFeeStatus).toHaveBeenCalled();
  });

  it('clears transient rows: manifest search narrows by name or role number', async () => {
    const tx = makeTx();
    tx.transportAssignment.findMany = jest.fn(async (args: any) => [
      {
        id: 'assign-2',
        studentId: 'student-2',
        student: { ...student, id: 'student-2', firstName: 'Bilal' },
        route: { id: 'r' },
        stop: null,
      },
    ]);
    tx.transportAssignment.count = jest.fn(async () => 1);
    const { svc } = makeService(tx);
    const res: any = await svc.listTransportStudents(TENANT, {
      page: 1,
      limit: 50,
      search: 'Bilal',
    });
    expect(res.total).toBe(1);
    expect(res.data[0].studentName).toBe('Bilal Khalid');
  });
});

describe('dashboard', () => {
  it('counts vehicles by status, routes, assigned students and trips today', async () => {
    const tx = makeTx({
      buses: [
        { id: 'b1', status: 'ACTIVE' },
        { id: 'b2', status: 'ACTIVE' },
        { id: 'b3', status: 'MAINTENANCE' },
      ],
      routes: [{ id: 'r1' }, { id: 'r2' }],
      assignments: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
      trips: [{ id: 't1', status: 'IN_PROGRESS' }],
      students: [],
    });
    tx.transportTrip.findMany = jest.fn(async () => [
      { id: 't1', status: 'IN_PROGRESS' },
    ]);
    const { svc } = makeService(tx);
    const dash: any = await svc.getDashboard(TENANT);
    expect(dash.vehicles).toMatchObject({
      total: 3,
      active: 2,
      maintenance: 1,
      inactive: 0,
    });
    expect(dash.routes).toBe(2);
    expect(dash.studentsAssigned).toBe(3);
    expect(dash.tripsToday).toMatchObject({
      total: 1,
      inProgress: 1,
      completed: 0,
    });
  });
});

describe('trips', () => {
  const rider = {
    id: 'student-1',
    firstName: 'Amina',
    lastName: 'Khalid',
    roleNumber: '2026-001',
    guardians: [{ guardian: { userId: 'guardian-user-1' } }],
  };

  const tripFixture = (extra: any = {}) =>
    makeTx({
      routes: [{ id: 'route-1', name: 'El Omda North', shift: 'BOTH' }],
      stops: [{ id: 'stop-1', routeId: 'route-1', name: 'Gate', sequence: 1 }],
      assignments: [{ id: 'assign-1', studentId: 'student-1', routeId: 'route-1', student: rider, route: { id: 'route-1', name: 'El Omda North' } }],
      ...extra,
    });

  it('starts a trip, notifies the route guardians and emits bus_trip_started', async () => {
    const tx = tripFixture();
    const { svc, realtime } = makeService(tx);
    const res: any = await svc.startTrip(TENANT, 'route-1');

    expect(res.id).toBe('trip-new');
    expect(res.status).toBe('IN_PROGRESS');
    expect(tx.transportTrip.create).toHaveBeenCalled();

    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        userId: 'guardian-user-1',
        type: 'TRANSPORT_TRIP',
      }),
    });

    expect(realtime.emitDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'bus_trip_started',
        rooms: ['user:guardian-user-1'],
      }),
    );
  });

  it('rejects a second in-progress trip on the same route', async () => {
    const tx = tripFixture({ trips: [{ id: 't1', routeId: 'route-1', status: 'IN_PROGRESS' }] });
    const { svc } = makeService(tx);
    await expect(svc.startTrip(TENANT, 'route-1')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.transportTrip.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown route when reporting the trip', async () => {
    const { svc } = makeService(makeTx());
    await expect(svc.startTrip(TENANT, 'ghost-route')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('records an arrival with an event, notifications and a bus_arrived_stop emit', async () => {
    const tx = tripFixture({ trips: [{ id: 't1', routeId: 'route-1' }] });
    const { svc, realtime } = makeService(tx);
    const res: any = await svc.recordArrival(TENANT, 't1', 'stop-1');

    expect(res.type).toBe('ARRIVED_STOP');
    expect(tx.transportTripEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tripId: 't1',
        stopId: 'stop-1',
        type: 'ARRIVED_STOP',
      }),
    });
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        userId: 'guardian-user-1',
        type: 'TRANSPORT_TRIP',
      }),
    });
    expect(realtime.emitDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'bus_arrived_stop',
        rooms: ['user:guardian-user-1'],
        payload: expect.objectContaining({ stopId: 'stop-1', routeId: 'route-1' }),
      }),
    );
  });

  it('rejects an arrival when the trip is already completed', async () => {
    const tx = tripFixture({ trips: [{ id: 't1', routeId: 'route-1', status: 'COMPLETED' }] });
    const { svc } = makeService(tx);
    await expect(svc.recordArrival(TENANT, 't1', 'stop-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.transportTripEvent.create).not.toHaveBeenCalled();
  });

  it('rejects an arrival at a stop that is not on the trip route', async () => {
    const tx = tripFixture({
      trips: [{ id: 't1', routeId: 'route-1' }],
      stops: [{ id: 'stop-9', routeId: 'route-9', name: 'Elsewhere', sequence: 1 }],
    });
    const { svc } = makeService(tx);
    await expect(svc.recordArrival(TENANT, 't1', 'stop-9')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate arrival at the same stop', async () => {
    const tx = tripFixture({
      trips: [{ id: 't1', routeId: 'route-1' }],
      events: [{ id: 'e1', tripId: 't1', stopId: 'stop-1', type: 'ARRIVED_STOP' }],
    });
    const { svc } = makeService(tx);
    await expect(svc.recordArrival(TENANT, 't1', 'stop-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('completes a trip without emitting an event', async () => {
    const tx = tripFixture({ trips: [{ id: 't1', routeId: 'route-1' }] });
    const { svc, realtime } = makeService(tx);
    const res: any = await svc.completeTrip(TENANT, 't1');
    expect(res.status).toBe('COMPLETED');
    expect(tx.transportTrip.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(realtime.emitDomainEvent).not.toHaveBeenCalled();
  });

  it('gets trip detail with events and route', async () => {
    const tx = tripFixture({ trips: [{ id: 't1', routeId: 'route-1' }], events: [{ id: 'e1', tripId: 't1', stopId: 'stop-1', type: 'ARRIVED_STOP', stop: { name: 'Gate' } }] });
    const { svc } = makeService(tx);
    const res: any = await svc.getTrip(TENANT, 't1');
    expect(res.route.name).toBe('El Omda North');
    expect(res.events).toHaveLength(1);
  });

  it('rejects an unknown trip on getTrip', async () => {
    const { svc } = makeService(makeTx());
    await expect(svc.getTrip(TENANT, 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists trip history for a route (newest first)', async () => {
    const tx = tripFixture({
      trips: [
        { id: 't2', routeId: 'route-1', startedAt: new Date('2026-01-02T06:00:00Z') },
        { id: 't1', routeId: 'route-1', startedAt: new Date('2026-01-01T06:00:00Z') },
      ],
    });
    const { svc } = makeService(tx);
    const res: any = await svc.listTrips(TENANT, 'route-1');
    expect(res.map((t: any) => t.id)).toEqual(['t2', 't1']);
  });
});

describe('vehicle details', () => {
  it('returns a bus with its routes plus per-route stop/assignment counts', async () => {
    const tx = makeTx({
      buses: [{ id: 'bus-1', plateNumber: 'PL-1', status: 'ACTIVE', capacity: 20 }],
      routes: [
        { id: 'route-3', busId: 'bus-9', name: 'Other' },
        { id: 'route-2', busId: 'bus-1', name: 'South', shift: 'EVENING' },
        { id: 'route-1', busId: 'bus-1', name: 'North', shift: 'BOTH' },
      ],
      stops: [
        { id: 's1', routeId: 'route-1', name: 'A', sequence: 1 },
        { id: 's2', routeId: 'route-1', name: 'B', sequence: 2 },
      ],
      assignments: [
        { id: 'a1', studentId: 'student-1', routeId: 'route-2' },
      ],
    });
    const { svc } = makeService(tx);
    const res: any = await svc.getVehicle(TENANT, 'bus-1');
    expect(res.plateNumber).toBe('PL-1');
    // only this bus's routes, name-ordered
    expect(res.routes.map((r: any) => r.id)).toEqual(['route-1', 'route-2']);
    expect(res.routes[0]._count).toMatchObject({ stops: 2, assignments: 0 });
    expect(res.routes[1]._count).toMatchObject({ stops: 0, assignments: 1 });
  });

  it('rejects an unknown bus', async () => {
    const { svc } = makeService(makeTx());
    await expect(svc.getVehicle(TENANT, 'ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('assignable student candidates', () => {
  const rows = (tenantId: string) => [
    {
      id: 'student-1',
      tenantId,
      firstName: 'Amina',
      middleName: null,
      lastName: 'Khalid',
      roleNumber: '2026-001',
    },
    {
      id: 'student-2',
      tenantId,
      firstName: 'Bilal',
      middleName: null,
      lastName: 'Osman',
      roleNumber: '2026-002',
    },
    {
      id: 'student-3',
      tenantId,
      firstName: 'Sara',
      middleName: null,
      lastName: 'Idris',
      roleNumber: '2026-003',
    },
  ];

  it('lists tenant students with their current assignment badges', async () => {
    const tx = makeTx({
      students: rows(TENANT),
      routes: [{ id: 'route-1', name: 'El Omda North', shift: 'BOTH' }],
      stops: [{ id: 'stop-1', routeId: 'route-1', name: 'Gate', sequence: 1 }],
      assignments: [
        { id: 'a1', tenantId: TENANT, studentId: 'student-2', routeId: 'route-1', stopId: 'stop-1' },
      ],
    });
    const { svc } = makeService(tx);
    const res: any = await svc.listAssignableStudents(TENANT, {
      page: 1,
      limit: 50,
    });
    expect(res.total).toBe(3);
    expect(res.data).toHaveLength(3);
    const bilal = res.data.find((s: any) => s.id === 'student-2');
    expect(bilal.assignment).toMatchObject({
      routeId: 'route-1',
      routeName: 'El Omda North',
      stopId: 'stop-1',
      stopName: 'Gate',
    });
    const amina = res.data.find((s: any) => s.id === 'student-1');
    expect(amina.assignment).toBeNull();
  });

  it('narrowed search matches name or role number, case-insensitive', async () => {
    const tx = makeTx({ students: rows(TENANT) });
    const { svc } = makeService(tx);
    const byName: any = await svc.listAssignableStudents(TENANT, {
      page: 1,
      limit: 50,
      search: 'amina',
    });
    expect(byName.total).toBe(1);
    expect(byName.data[0].id).toBe('student-1');
    const byRole: any = await svc.listAssignableStudents(TENANT, {
      page: 1,
      limit: 50,
      search: '003',
    });
    expect(byRole.total).toBe(1);
    expect(byRole.data[0].id).toBe('student-3');
  });

  it('paginates candidates', async () => {
    const tx = makeTx({ students: rows(TENANT) });
    const { svc } = makeService(tx);
    const res: any = await svc.listAssignableStudents(TENANT, {
      page: 2,
      limit: 2,
    });
    expect(res.total).toBe(3);
    expect(res.data).toHaveLength(1);
  });
});

describe('manifest bus filter', () => {
  it('filters manifest assignments to the routes of one bus', async () => {
    const tx = makeTx();
    tx.transportAssignment.findMany = jest.fn(async () => [
      {
        id: 'a1',
        studentId: 'student-1',
        routeId: 'route-1',
        student: {
          id: 'student-1',
          firstName: 'Amina',
          lastName: 'Khalid',
          roleNumber: '2026-001',
        },
        route: { id: 'route-1', name: 'North', shift: 'BOTH' },
        stop: null,
      },
    ]);
    tx.transportAssignment.count = jest.fn(async (args: any) =>
      args?.where?.route?.busId ? 1 : 0,
    );
    const { svc } = makeService(tx);
    const res: any = await svc.listTransportStudents(TENANT, {
      page: 1,
      limit: 50,
      busId: 'bus-1',
    });
    expect(res.total).toBe(1);
    expect(res.data[0].studentName).toBe('Amina Khalid');
    expect(tx.transportAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ route: { busId: 'bus-1' } }),
      }),
    );
  });
});

describe('batch assignments', () => {
  const students = [
    { id: 'student-1', firstName: 'Amina', lastName: 'Khalid', roleNumber: '2026-001' },
    { id: 'student-2', firstName: 'Bilal', lastName: 'Osman', roleNumber: '2026-002' },
  ];
  const route = { id: 'route-1', name: 'North', shift: 'BOTH' };

  it('assigns every selected student in one transaction and syncs fees', async () => {
    const tx = makeTx({ routes: [route], students });
    const finance: any = { setStudentTransportFee: jest.fn(async () => ({})) };
    const { svc } = makeService(tx, finance);
    const res: any = await svc.assignStudentsBatch(TENANT, {
      studentIds: ['student-1', 'student-2'],
      routeId: 'route-1',
      transportFee: 250000,
    });
    expect(res.assigned).toBe(2);
    expect(tx.transportAssignment.create).toHaveBeenCalledTimes(2);
    expect(tx.transportAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          studentId: 'student-2',
          routeId: 'route-1',
        }),
      }),
    );
    expect(finance.setStudentTransportFee).toHaveBeenCalledTimes(2);
    expect(finance.setStudentTransportFee).toHaveBeenCalledWith(
      TENANT,
      'student-1',
      250000,
    );
  });

  it('re-assigns an already-assigned student via update, not create', async () => {
    const tx = makeTx({
      routes: [route],
      students,
      assignments: [
        { id: 'assign-1', tenantId: TENANT, studentId: 'student-1', routeId: 'route-1' },
      ],
    });
    const { svc } = makeService(tx);
    const res: any = await svc.assignStudentsBatch(TENANT, {
      studentIds: ['student-1', 'student-2'],
      routeId: 'route-1',
    });
    expect(res.assigned).toBe(2);
    expect(tx.transportAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'assign-1' },
        data: expect.objectContaining({ routeId: 'route-1' }),
      }),
    );
    expect(tx.transportAssignment.create).toHaveBeenCalledTimes(1); // only student-2
  });

  it('rejects one unknown student without writing anything', async () => {
    const tx = makeTx({ routes: [route], students: [students[0]] });
    const { svc } = makeService(tx);
    await expect(
      svc.assignStudentsBatch(TENANT, {
        studentIds: ['student-1', 'ghost'],
        routeId: 'route-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.transportAssignment.create).not.toHaveBeenCalled();
    expect(tx.transportAssignment.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown route without writing anything', async () => {
    const tx = makeTx({ students });
    const { svc } = makeService(tx);
    await expect(
      svc.assignStudentsBatch(TENANT, {
        studentIds: ['student-1'],
        routeId: 'ghost',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.transportAssignment.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate students in one payload', async () => {
    const tx = makeTx({ routes: [route], students });
    const { svc } = makeService(tx);
    await expect(
      svc.assignStudentsBatch(TENANT, {
        studentIds: ['student-1', 'student-1'],
        routeId: 'route-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.transportAssignment.create).not.toHaveBeenCalled();
  });

  it('rejects an empty selection', async () => {
    const tx = makeTx({ routes: [route], students });
    const { svc } = makeService(tx);
    await expect(
      svc.assignStudentsBatch(TENANT, { studentIds: [], routeId: 'route-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
