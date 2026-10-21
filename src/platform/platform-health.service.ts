import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The health of the platform itself: is the database answering, how much
 * data is in it, how many people are connected right now, and how much
 * disk the file storage takes.
 *
 * The report is read-only and never throws: a failing dependency has to
 * show up in the report, not take the endpoint down with it.
 */
@Injectable()
export class PlatformHealthService {
  constructor(
    private prisma: PrismaService,
    @Optional() private readonly realtime?: RealtimeGateway,
  ) {}

  private get storageRoot(): string {
    return process.env.STORAGE_ROOT || 'storage';
  }

  async report() {
    const checkedAt = new Date();
    const database = await this.checkDatabase();
    const [counts, storage, connections] = await Promise.all([
      this.counts(),
      this.storageUsage(),
      Promise.resolve(this.connections()),
    ]);

    return {
      status: database.reachable ? 'ok' : 'degraded',
      checkedAt: checkedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database,
      counts,
      realtime: { connections },
      storage,
      process: {
        node: process.version,
        platform: process.platform,
        memory: {
          rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
        },
      },
    };
  }

  private async checkDatabase() {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return {
        reachable: true,
        latencyMs: Date.now() - startedAt,
        error: null as string | null,
      };
    } catch (error) {
      return {
        reachable: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : 'The database did not answer',
      };
    }
  }

  private async counts() {
    const [
      tenants,
      activeTenants,
      suspendedTenants,
      archivedTenants,
      users,
      students,
      teachers,
      licences,
      activeLicences,
      plans,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.tenant.count({ where: { status: 'ARCHIVED' } }),
      this.prisma.user.count(),
      this.prisma.student.count(),
      this.prisma.teacher.count(),
      this.prisma.tenantLicense.count(),
      this.prisma.tenantLicense.count({ where: { status: 'ACTIVE' } }),
      this.prisma.platformPlan.count(),
    ]);

    return {
      tenants,
      activeTenants,
      suspendedTenants,
      archivedTenants,
      users,
      students,
      teachers,
      licences,
      activeLicences,
      plans,
    };
  }

  private connections(): number {
    return this.realtime?.server?.engine?.clientsCount ?? 0;
  }

  /**
   * Walks the storage folder and reports its size. The walk is bounded so a
   * large tree cannot turn a health check into a long operation.
   */
  private async storageUsage() {
    let bytes = 0;
    let files = 0;
    let truncated = false;
    const limit = 5000;

    async function walk(dir: string): Promise<void> {
      if (files >= limit) {
        truncated = true;
        return;
      }
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files >= limit) {
          truncated = true;
          return;
        }
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          try {
            const stats = await stat(full);
            bytes += stats.size;
            files += 1;
          } catch {
            // A file that vanished mid-walk is not a health problem.
          }
        }
      }
    }

    await walk(this.storageRoot);

    return {
      root: this.storageRoot,
      bytes,
      files,
      truncated,
    };
  }
}

export function assertStorageRoot(value: string): string {
  if (!value?.trim()) {
    throw new BadRequestException('The storage root is not configured');
  }
  return value.trim();
}
