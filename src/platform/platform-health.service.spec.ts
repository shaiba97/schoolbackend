import type { PrismaService } from '../prisma/prisma.service';

import { PlatformHealthService } from './platform-health.service';

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    tenant: { count: jest.fn().mockResolvedValue(7) },
    user: { count: jest.fn().mockResolvedValue(120) },
    student: { count: jest.fn().mockResolvedValue(900) },
    teacher: { count: jest.fn().mockResolvedValue(60) },
    tenantLicense: { count: jest.fn().mockResolvedValue(7) },
    platformPlan: { count: jest.fn().mockResolvedValue(5) },
    ...overrides,
  } as unknown as PrismaService;

  const realtime = { server: { engine: { clientsCount: 12 } } };
  const service = new PlatformHealthService(prisma, realtime as never);
  return { service, prisma };
}

describe('PlatformHealthService.report', () => {
  it('reports the database latency and the platform counts', async () => {
    const { service } = build();

    const report = await service.report();

    expect(report.status).toBe('ok');
    expect(report.database.reachable).toBe(true);
    expect(typeof report.database.latencyMs).toBe('number');
    expect(report.counts).toMatchObject({
      tenants: 7,
      users: 120,
      students: 900,
      teachers: 60,
      activeLicences: 7,
      plans: 5,
    });
  });

  it('marks the platform degraded when the database does not answer', async () => {
    const { service } = build({
      $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('connection refused')),
    });

    const report = await service.report();

    expect(report.status).toBe('degraded');
    expect(report.database.reachable).toBe(false);
    expect(report.database.error).toContain('connection refused');
  });

  it('reports the number of connected sockets', async () => {
    const { service } = build();

    const report = await service.report();

    expect(report.realtime.connections).toBe(12);
  });

  it('reports zero connections when the gateway is not attached', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      tenant: { count: jest.fn().mockResolvedValue(0) },
      user: { count: jest.fn().mockResolvedValue(0) },
      student: { count: jest.fn().mockResolvedValue(0) },
      teacher: { count: jest.fn().mockResolvedValue(0) },
      tenantLicense: { count: jest.fn().mockResolvedValue(0) },
      platformPlan: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;

    const report = await new PlatformHealthService(prisma, undefined).report();

    expect(report.realtime.connections).toBe(0);
  });

  it('reports uptime and process memory', async () => {
    const { service } = build();

    const report = await service.report();

    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(report.process.memory.rssMb).toBeGreaterThan(0);
    expect(report.process.node).toBe(process.version);
  });
});
