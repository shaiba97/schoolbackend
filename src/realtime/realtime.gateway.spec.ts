import { roomsForTarget, RealtimeGateway } from './realtime.gateway';

describe('roomsForTarget', () => {
  it('routes a student target to that user room only', () => {
    expect(roomsForTarget('STUDENT', 'user-1')).toEqual(['user:user-1']);
  });

  it('routes a class target to that class room only', () => {
    expect(roomsForTarget('CLASS', 'class-9')).toEqual(['class:class-9']);
  });

  it('routes a grade target to the grade room', () => {
    expect(roomsForTarget('GRADE', 'SECONDARY:1')).toEqual(['grade:SECONDARY:1']);
  });

  it('routes an education-level target to the level room', () => {
    expect(roomsForTarget('EDUCATION_LEVEL', 'SECONDARY')).toEqual(['level:SECONDARY']);
  });

  it('routes a school-wide target to the shared room', () => {
    expect(roomsForTarget('SCHOOL_WIDE', null)).toEqual(['school-wide']);
  });

  it('resolves nothing for a missing target id', () => {
    expect(roomsForTarget('STUDENT', null)).toEqual([]);
    expect(roomsForTarget('CLASS', null)).toEqual([]);
    expect(roomsForTarget('GRADE', null)).toEqual([]);
  });

  it('resolves nothing for an unknown target type instead of broadcasting', () => {
    expect(roomsForTarget('EVERYTHING', 'x')).toEqual([]);
  });
});

describe('RealtimeGateway.emitDomainEvent', () => {
  function gateway() {
    const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
    const server = {
      to: jest.fn((room: string) => ({
        emit: jest.fn((event: string, payload: unknown) => {
          emitted.push({ room, event, payload });
        }),
      })),
    };
    const service = new RealtimeGateway({} as never, {} as never);
    (service as unknown as { server: unknown }).server = server;
    return { service, server, emitted };
  }

  it('fans out to every room under the event kind', async () => {
    const { service, emitted } = gateway();

    await service.emitDomainEvent({
      kind: 'marks.entered',
      rooms: ['class:a', 'class:b'],
      payload: { examId: 'e1' },
    });

    expect(emitted).toEqual([
      { room: 'class:a', event: 'marks.entered', payload: { kind: 'marks.entered', examId: 'e1' } },
      { room: 'class:b', event: 'marks.entered', payload: { kind: 'marks.entered', examId: 'e1' } },
    ]);
  });

  it('sends nothing when there are no rooms', async () => {
    const { service, server, emitted } = gateway();

    await service.emitDomainEvent({ kind: 'exam.published', rooms: [], payload: {} });

    expect(server.to).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });
});

describe('RealtimeGateway.handleConnection', () => {
  const USER = 'user-1';
  const TENANT = 'tenant-1';

  function mocks() {
    const verifyAsync = jest.fn();
    const jwt = { verifyAsync };
    const prisma = {
      tenantMembership: { findFirst: jest.fn() },
      student: { findFirst: jest.fn() },
      studentEnrollment: { findFirst: jest.fn() },
    };
    const service = new RealtimeGateway(jwt as never, prisma as never);
    return { service, jwt: verifyAsync, prisma };
  }

  function client(authToken?: string) {
    return {
      id: 'socket-1',
      handshake: authToken
        ? { auth: { token: authToken }, headers: {} }
        : { auth: {}, headers: {} },
      join: jest.fn(),
      disconnect: jest.fn(),
    };
  }

  function ticketed(prisma: {
    tenantMembership: { findFirst: jest.Mock };
    student: { findFirst: jest.Mock };
    studentEnrollment: { findFirst: jest.Mock };
  }) {
    prisma.tenantMembership.findFirst.mockResolvedValue({
      userId: USER,
      tenantId: TENANT,
    });
    prisma.student.findFirst.mockResolvedValue({
      id: 'student-1',
      educationLevel: 'SECONDARY',
      grade: 'FIRST',
    });
    prisma.studentEnrollment.findFirst.mockResolvedValue({
      classId: 'class-1',
    });
  }

  it('disconnects immediately when no token is supplied', async () => {
    const { service } = mocks();
    const socket = client();

    await service.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('disconnects when the token verifies under neither audience', async () => {
    const { service, jwt } = mocks();
    jwt.mockRejectedValue(new Error('invalid'));
    const socket = client('garbage');

    await service.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('disconnects a valid token with no active membership', async () => {
    const { service, jwt, prisma } = mocks();
    jwt.mockImplementation((token: string, opts?: { audience?: string }) => {
      if (opts?.audience === 'socket') return Promise.resolve({ sub: USER, tenantId: TENANT });
      return Promise.reject(new Error('not a session token'));
    });
    prisma.tenantMembership.findFirst.mockResolvedValue(null);
    const socket = client('ticket-abc');

    await service.handleConnection(socket as never);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('joins identity rooms for a ticketed student with active membership', async () => {
    const { service, jwt, prisma } = mocks();
    jwt.mockImplementation((token: string, opts?: { audience?: string }) => {
      if (opts?.audience === 'socket') return Promise.resolve({ sub: USER, tenantId: TENANT });
      return Promise.reject(new Error('not a session token'));
    });
    ticketed(prisma);
    const socket = client('ticket-abc');

    await service.handleConnection(socket as never);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith([
      `user:${USER}`,
      'school-wide',
      'class:class-1',
      'grade:SECONDARY:FIRST',
      'level:SECONDARY',
    ]);
  });

  it('joins every linked ward rooms for a guardian connection', async () => {
    const { service, jwt, prisma } = mocks();
    jwt.mockImplementation((token: string, opts?: { audience?: string }) => {
      if (opts?.audience === 'socket') return Promise.resolve({ sub: USER, tenantId: TENANT });
      return Promise.reject(new Error('not a session token'));
    });
    (prisma as any).tenantMembership.findFirst.mockResolvedValue({ userId: USER, tenantId: TENANT });
    (prisma as any).student.findFirst.mockResolvedValue(null);
    (prisma as any).guardian = {
      findFirst: jest.fn().mockResolvedValue({ id: 'guardian-1' }),
    };
    (prisma as any).studentGuardian = {
      findMany: jest.fn().mockResolvedValue([
        { student: { id: 's-1', educationLevel: 'SECONDARY', grade: 'FIRST' } },
        { student: { id: 's-2', educationLevel: 'SECONDARY', grade: 'SECOND' } },
      ]),
    };
    (prisma as any).studentEnrollment = {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ classId: 'class-1' })
        .mockResolvedValueOnce({ classId: 'class-2' }),
    };
    const socket = client('ticket-abc');

    await service.handleConnection(socket as never);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith([
      `user:${USER}`,
      'school-wide',
      'class:class-1',
      'grade:SECONDARY:FIRST',
      'level:SECONDARY',
      'class:class-2',
      'grade:SECONDARY:SECOND',
    ]);
  });
});

describe('RealtimeGateway.resolveRooms — finance staffing', () => {
  const USER = 'user-1';
  const TENANT = 'tenant-1';

  function staffMocks() {
    const verifyAsync = jest.fn();
    const jwt = { verifyAsync };
    const prisma = {
      tenantMembership: { findFirst: jest.fn() },
      student: { findFirst: jest.fn().mockResolvedValue(null) },
      guardian: { findFirst: jest.fn().mockResolvedValue(null) },
      studentEnrollment: { findFirst: jest.fn() },
    };
    const service = new RealtimeGateway(jwt as never, prisma as never);
    return { service, jwt: verifyAsync, prisma };
  }

  function ticketedJwt(jwt: jest.Mock) {
    jwt.mockImplementation((token: string, opts?: { audience?: string }) => {
      if (opts?.audience === 'socket') return Promise.resolve({ sub: USER, tenantId: TENANT });
      return Promise.reject(new Error('not a session token'));
    });
  }

  function client(authToken: string) {
    return {
      id: 'socket-1',
      handshake: { auth: { token: authToken }, headers: {} },
      join: jest.fn(),
      disconnect: jest.fn(),
    };
  }

  it('joins the finance room for a staff connection holding a finance role', async () => {
    const { service, jwt, prisma } = staffMocks();
    ticketedJwt(jwt);
    prisma.tenantMembership.findFirst
      .mockResolvedValueOnce({ userId: USER, tenantId: TENANT })
      .mockResolvedValueOnce({ roles: [{ role: { slug: 'ACCOUNTANT' } }] });
    const socket = client('ticket-abc');

    await service.handleConnection(socket as never);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith([`user:${USER}`, 'school-wide', 'tenant:tenant-1:finance']);
  });

  it('keeps a staff connection without a finance role out of the finance room', async () => {
    const { service, jwt, prisma } = staffMocks();
    ticketedJwt(jwt);
    prisma.tenantMembership.findFirst
      .mockResolvedValueOnce({ userId: USER, tenantId: TENANT })
      .mockResolvedValueOnce({ roles: [{ role: { slug: 'RECEPTIONIST' } }] });
    const socket = client('ticket-abc');

    await service.handleConnection(socket as never);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.join).toHaveBeenCalledWith([`user:${USER}`, 'school-wide']);
  });
});
