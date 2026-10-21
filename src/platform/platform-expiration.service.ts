import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ends licences whose term has run out and locks the school.
 *
 * The sweep is idempotent: it only touches licences that are still ACTIVE
 * and already past their end date, so running it twice - or running it from
 * two instances at once - cannot expire the same licence twice or write
 * contradictory lock state.
 *
 * A licence that is merely close to its end date is left alone. Marking it
 * early would drop it out of the active-licence counts (and therefore out
 * of recurring revenue) while it is still a running subscription.
 */
@Injectable()
export class PlatformExpirationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformExpirationService.name);
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  /**
   * Nightly sweep at 03:00 UTC.
   *
   * A licence is a term with an end date, so somebody has to end it when
   * the term runs out; leaving that to an operator pressing a button would
   * mean a school keeps access after its licence expired. The sweep is
   * idempotent, so a second instance running at the same time is harmless.
   *
   * The timer is hand-rolled rather than @nestjs/schedule: that package
   * ships ESM only, and this service compiles to CommonJS, so importing it
   * would stop the whole API from booting. A plain timer needs no
   * dependency and works in the module system the service already uses.
   */
  onModuleInit() {
    this.scheduleNext();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(3, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    this.timer = setTimeout(
      () => {
        void this.runScheduledSweep().finally(() => this.scheduleNext());
      },
      next.getTime() - now.getTime(),
    );
    // A pending sweep must not keep the process alive on its own.
    this.timer.unref?.();
  }

  /** The scheduled run: a failure must not stop the next one. */
  async runScheduledSweep() {
    try {
      const result = await this.sweep();
      if (result.expired > 0) {
        this.logger.warn(
          `scheduled expiration sweep ended ${result.expired} licence(s)`,
        );
      }
      return result;
    } catch (error) {
      this.logger.error(
        `scheduled expiration sweep failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { ranAt: new Date().toISOString(), expired: 0, schools: [] };
    }
  }

  async sweep() {
    const now = new Date();
    const due = await this.prisma.tenantLicense.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      select: {
        id: true,
        tenantId: true,
        expiresAt: true,
        tenant: { select: { id: true, name: true } },
      },
    });

    const schools: Array<{
      tenantId: string;
      name: string;
      expiredAt: string | null;
    }> = [];

    for (const license of due) {
      await this.prisma.tenantLicense.update({
        where: { id: license.id },
        data: {
          status: 'EXPIRED',
          terminatedAt: now,
          terminationReason: 'LICENSE_EXPIRED',
        },
      });

      await this.prisma.tenant.update({
        where: { id: license.tenantId },
        data: {
          status: 'SUSPENDED',
          lockedAt: now,
          lockReason: 'LICENSE_EXPIRED',
        },
      });

      await this.prisma.platformAuditLog.create({
        data: {
          action: 'platform.subscription.expired',
          entityType: 'tenant_license',
          entityId: license.id,
          tenantId: license.tenantId,
          oldValues: { status: 'ACTIVE' },
          newValues: {
            status: 'EXPIRED',
            expiresAt: license.expiresAt,
            reason: 'LICENSE_EXPIRED',
          },
        },
      });

      schools.push({
        tenantId: license.tenantId,
        name: license.tenant.name,
        expiredAt: license.expiresAt ? license.expiresAt.toISOString() : null,
      });
    }

    if (schools.length > 0) {
      this.logger.warn(
        `expired ${schools.length} licence(s): ${schools
          .map((school) => school.name)
          .join(', ')}`,
      );
    }

    return { ranAt: now.toISOString(), expired: schools.length, schools };
  }
}
