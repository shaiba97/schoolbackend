import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformActor } from './platform-tenants.service';
import {
  MAXIMUM_TERM_YEARS,
  MINIMUM_TERM_YEARS,
  monthlyEquivalent,
  termTotal,
  termYears,
} from './platform-pricing';

export type PlanActor = PlatformActor;

export type TierInput = {
  code: string;
  name: string;
  tier: 'PRIMARY' | 'INTERMEDIATE' | 'ADVANCED' | 'CUSTOM';
  target?: string;
  billingModel: 'ANNUAL';
  /** The flat yearly price the school pays. */
  price: number;
  currency: string;
  durationDays: number;
  includedModules?: string[];
  features?: Record<string, boolean | number | string>;
};

export type TierUpdate = {
  name?: string;
  target?: string | null;
  price?: number;
  currency?: string;
  durationDays?: number;
  includedModules?: string[];
  features?: Record<string, boolean | number | string>;
  isActive?: boolean;
};

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,59}$/;
const EXPIRING_SOON_DAYS = 30;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The plan catalogue and the subscriptions that sit on it: which schools
 * hold which tier, when the term ends, and the three actions an operator
 * takes on a subscription - renew, terminate, upgrade.
 *
 * Renewing or terminating changes the school's lock state, so this service
 * writes the same lock columns the expiration sweep writes. The lock itself
 * is enforced by TenantGuard.
 */
@Injectable()
export class PlatformPlansService {
  constructor(private prisma: PrismaService) {}

  async listTiers() {
    const plans = await this.prisma.platformPlan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
    });

    return plans.map((plan) => this.toTier(plan));
  }

  async createTier(input: TierInput, actor: PlatformActor) {
    this.assertTierInput(input);

    const existing = await this.prisma.platformPlan.findUnique({
      where: { code: input.code },
    });
    if (existing) {
      throw new ConflictException('A tier with this code already exists');
    }

    const plan = await this.prisma.platformPlan.create({
      data: {
        code: input.code,
        name: input.name.trim(),
        tier: input.tier,
        target: input.target?.trim() || null,
        billingModel: input.billingModel,
        price: input.price,
        currency: input.currency.trim().toUpperCase(),
        durationDays: input.durationDays,
        includedModules: (input.includedModules ?? []) as never,
        features: (input.features ?? {}) as never,
        isActive: true,
        sortOrder: 100,
      },
    });

    await this.audit(actor, {
      action: 'platform.tier.created',
      entityType: 'platform_plan',
      entityId: plan.id,
      newValues: { code: plan.code, name: plan.name, price: Number(plan.price) },
    });

    return this.toTier(plan);
  }

  async updateTier(id: string, input: TierUpdate, actor: PlatformActor) {
    const existing = await this.prisma.platformPlan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tier not found');

    if (input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0)) {
      throw new BadRequestException('The price cannot be negative');
    }
    if (
      input.durationDays !== undefined &&
      (!Number.isInteger(input.durationDays) || input.durationDays <= 0)
    ) {
      throw new BadRequestException('The term must be a positive number of days');
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.target !== undefined) data.target = input.target?.trim() || null;
    if (input.price !== undefined) data.price = input.price;
    if (input.currency !== undefined) data.currency = input.currency.trim().toUpperCase();
    if (input.durationDays !== undefined) data.durationDays = input.durationDays;
    if (input.includedModules !== undefined) {
      data.includedModules = input.includedModules as never;
    }
    if (input.features !== undefined) data.features = input.features as never;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const plan = await this.prisma.platformPlan.update({ where: { id }, data });

    await this.audit(actor, {
      action: 'platform.tier.updated',
      entityType: 'platform_plan',
      entityId: id,
      oldValues: {
        name: existing.name,
        price: Number(existing.price),
        durationDays: existing.durationDays,
        isActive: existing.isActive,
      },
      newValues: {
        name: plan.name,
        price: Number(plan.price),
        durationDays: plan.durationDays,
        isActive: plan.isActive,
      },
    });

    return this.toTier(plan);
  }

  /**
   * Removes a tier from the catalogue.
   *
   * A tier that any school still holds cannot be deleted: the licence would
   * point at a missing plan. The operator moves those schools to another
   * tier first, and the message says how many are in the way.
   */
  async deleteTier(id: string, actor: PlatformActor) {
    const plan = await this.prisma.platformPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Tier not found');

    const licences = await this.prisma.tenantLicense.count({
      where: { planId: id },
    });
    if (licences > 0) {
      throw new ConflictException(
        `${licences} licence(s) still point at this tier. Move those schools to another tier before deleting it.`,
      );
    }

    await this.prisma.platformPlan.delete({ where: { id } });

    await this.audit(actor, {
      action: 'platform.tier.deleted',
      entityType: 'platform_plan',
      entityId: id,
      oldValues: {
        code: plan.code,
        name: plan.name,
        price: Number(plan.price),
        currency: plan.currency,
        durationDays: plan.durationDays,
      },
    });

    return { id, code: plan.code, name: plan.name, deleted: true };
  }

  async subscriptions() {
    const tenants = await this.prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        countryCode: true,
        currencyCode: true,
        status: true,
        logoUrl: true,
        lockedAt: true,
        lockReason: true,
        licenses: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            startedAt: true,
            expiresAt: true,
            terminatedAt: true,
            seats: true,
            yearlyPrice: true,
            plan: {
              select: {
                id: true,
                code: true,
                name: true,
                tier: true,
                price: true,
                currency: true,
                durationDays: true,
              },
            },
          },
        },
      },
    });

    const now = Date.now();

    return tenants.map((tenant) => {
      const license = tenant.licenses[0] ?? null;
      const plan = license?.plan ?? null;
      const expiresAt = license?.expiresAt ?? null;
      const daysRemaining = expiresAt
        ? Math.floor((expiresAt.getTime() - now) / (24 * 60 * 60 * 1000))
        : null;

      let status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'SUSPENDED' | 'NO_LICENSE';
      if (!license) {
        status = 'NO_LICENSE';
      } else if (license.status === 'SUSPENDED') {
        status = 'SUSPENDED';
      } else if (license.status === 'EXPIRED') {
        status = 'EXPIRED';
      } else if (expiresAt && expiresAt.getTime() < now) {
        status = 'EXPIRED';
      } else if (
        daysRemaining !== null &&
        daysRemaining <= EXPIRING_SOON_DAYS
      ) {
        status = 'EXPIRING_SOON';
      } else {
        status = 'ACTIVE';
      }

      const locked = Boolean(tenant.lockedAt) || Boolean(license?.terminatedAt);

      // The yearly rate the licence bills: its own rate when it quotes one,
      // otherwise the tier's price.
      const yearlyPrice = plan
        ? license?.yearlyPrice !== null && license?.yearlyPrice !== undefined
          ? Number(license.yearlyPrice)
          : Number(plan.price)
        : 0;
      const years = termYears(
        license?.startedAt,
        license?.expiresAt,
        plan?.durationDays ?? 365,
      );

      return {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        countryCode: tenant.countryCode,
        currencyCode: tenant.currencyCode,
        logoUrl: tenant.logoUrl,
        tenantStatus: tenant.status,
        licenseId: license?.id ?? null,
        tier: plan?.code ?? null,
        tierName: plan?.name ?? null,
        tierLabel: plan?.tier ?? null,
        yearlyPrice,
        /** The monthly equivalent of the yearly rate, and the yearly rate
         * itself - a subscription is bought for a term and paid yearly. */
        monthlyPrice: monthlyEquivalent(yearlyPrice),
        termYears: years,
        termTotal: termTotal(yearlyPrice, years ?? 0),
        currency: plan?.currency ?? 'USD',
        studentCount: license?.seats ?? 0,
        monthlyUsd: monthlyEquivalent(yearlyPrice),
        startedAt: license?.startedAt ?? null,
        expiresAt,
        daysRemaining,
        status,
        lockStatus: locked ? 'TERMINATED' : 'ACTIVE',
        lockReason: tenant.lockReason,
        lockedAt: tenant.lockedAt,
      };
    });
  }

  async renew(
    tenantId: string,
    input: {
      expiresAt?: Date;
      licenseId?: string;
      studentCount?: number;
      yearlyPrice?: number;
      years?: number;
    },
    actor: PlatformActor,
  ) {
    const tenant = await this.tenantWithLicenses(tenantId, input.licenseId);
    const license = tenant.licenses[0];
    if (!license) throw new NotFoundException('This school has no licence to renew');

    const years = this.assertTerm(input.years);
    const termDays = license.plan.durationDays || 365;
    const expiresAt =
      input.expiresAt ?? new Date(Date.now() + termDays * years * 24 * 60 * 60 * 1000);

    // The yearly rate the renewed term bills: a new quote, or the rate the
    // licence already carried.
    const yearlyPrice =
      input.yearlyPrice ??
      (license.yearlyPrice !== null && license.yearlyPrice !== undefined
        ? Number(license.yearlyPrice)
        : Number(license.plan.price));

    const updated = await this.prisma.tenantLicense.update({
      where: { id: license.id },
      data: {
        status: 'ACTIVE',
        expiresAt,
        terminatedAt: null,
        terminationReason: null,
        // The licensed student count says how big the school is.
        ...(input.studentCount !== undefined
          ? { seats: input.studentCount > 0 ? input.studentCount : null }
          : {}),
        yearlyPrice,
      },
    });

    // A school locked because its licence expired is unlocked by the
    // renewal; a school locked for any other reason stays locked.
    const unlock = tenant.lockReason === 'LICENSE_EXPIRED';
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: unlock
        ? { status: 'ACTIVE', lockedAt: null, lockReason: null }
        : { lockedAt: null, lockReason: null },
    });

    await this.audit(actor, {
      action: 'platform.subscription.renewed',
      entityType: 'tenant_license',
      entityId: license.id,
      tenantId: tenant.id,
      oldValues: { status: license.status, expiresAt: license.expiresAt },
      newValues: { status: 'ACTIVE', expiresAt, years, yearlyPrice },
    });

    return {
      licenseId: updated.id,
      tenantId: tenant.id,
      status: 'ACTIVE' as const,
      expiresAt: updated.expiresAt,
      unlocked: unlock,
      years,
      yearlyPrice,
      monthlyPrice: monthlyEquivalent(yearlyPrice),
      termTotal: termTotal(yearlyPrice, years),
    };
  }

  /**
   * A term is a whole number of years, and the shortest one is a year.
   * The rule lives here, not in the console, so a request for a shorter
   * term is refused whoever makes it.
   */
  private assertTerm(years: number | undefined): number {
    const value = years ?? MINIMUM_TERM_YEARS;
    if (!Number.isInteger(value) || value < MINIMUM_TERM_YEARS) {
      throw new BadRequestException(
        'The minimum subscription is one year.',
      );
    }
    if (value > MAXIMUM_TERM_YEARS) {
      throw new BadRequestException(
        `A single term may not run longer than ${MAXIMUM_TERM_YEARS} years.`,
      );
    }
    return value;
  }

  async terminate(tenantId: string, actor: PlatformActor) {
    const tenant = await this.tenantWithLicenses(tenantId);
    const license = tenant.licenses[0];
    if (!license) throw new NotFoundException('This school has no licence to end');

    const now = new Date();

    await this.prisma.tenantLicense.update({
      where: { id: license.id },
      data: {
        status: 'SUSPENDED',
        terminatedAt: now,
        terminationReason: 'MANUAL_TERMINATION',
      },
    });

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: 'SUSPENDED',
        lockedAt: now,
        lockReason: 'MANUAL_TERMINATION',
      },
    });

    await this.audit(actor, {
      action: 'platform.subscription.terminated',
      entityType: 'tenant_license',
      entityId: license.id,
      tenantId: tenant.id,
      oldValues: { status: license.status },
      newValues: { status: 'SUSPENDED', reason: 'MANUAL_TERMINATION' },
    });

    return { licenseId: license.id, tenantId: tenant.id, status: 'SUSPENDED' as const };
  }

  async upgrade(
    tenantId: string,
    input: {
      planId: string;
      expiresAt?: Date;
      yearlyPrice?: number;
      years?: number;
    },
    actor: PlatformActor,
  ) {
    const plan = await this.prisma.platformPlan.findUnique({
      where: { id: input.planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const years = this.assertTerm(input.years);
    const tenant = await this.tenantWithLicenses(tenantId);
    const license = tenant.licenses[0];

    if (!license) {
      const created = await this.prisma.tenantLicense.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt:
            input.expiresAt ??
            new Date(
              Date.now() + (plan.durationDays || 365) * years * 24 * 60 * 60 * 1000,
            ),
          yearlyPrice: input.yearlyPrice ?? Number(plan.price),
        },
      });

      await this.audit(actor, {
        action: 'platform.subscription.upgraded',
        entityType: 'tenant_license',
        entityId: created.id,
        tenantId: tenant.id,
        newValues: { planCode: plan.code, planId: plan.id, years },
      });

      await this.syncPortals(tenant.id, plan.includedModules);

      return {
        licenseId: created.id,
        tenantId: tenant.id,
        tier: plan.code,
        years,
        yearlyPrice: input.yearlyPrice ?? Number(plan.price),
        monthlyPrice: monthlyEquivalent(input.yearlyPrice ?? Number(plan.price)),
        termTotal: termTotal(input.yearlyPrice ?? Number(plan.price), years),
        expiresAt: created.expiresAt,
      };
    }

    // Moving to a tier starts that tier's term. A licence that came from the
    // lifetime plan has no end date, so without this the school would sit on
    // a yearly tier and never end.
    const termEndsAt =
      input.expiresAt ??
      new Date(
        Date.now() + (plan.durationDays || 365) * years * 24 * 60 * 60 * 1000,
      );
    const yearlyPrice =
      input.yearlyPrice ??
      (license.yearlyPrice !== null && license.yearlyPrice !== undefined
        ? Number(license.yearlyPrice)
        : Number(plan.price));

    await this.prisma.tenantLicense.update({
      where: { id: license.id },
      data: {
        planId: plan.id,
        expiresAt: termEndsAt,
        // A quoted tier has no list price, so the agreed yearly rate is
        // carried by the licence.
        yearlyPrice,
      },
    });

    // A school locked because its term ended gets its access back with the
    // new term.
    if (tenant.lockReason === 'LICENSE_EXPIRED') {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE', lockedAt: null, lockReason: null },
      });
    }

    await this.syncPortals(tenant.id, plan.includedModules);

    await this.audit(actor, {
      action: 'platform.subscription.upgraded',
      entityType: 'tenant_license',
      entityId: license.id,
      tenantId: tenant.id,
      oldValues: { planCode: license.plan.code, planId: license.plan.id },
      newValues: {
        planCode: plan.code,
        planId: plan.id,
        expiresAt: termEndsAt,
        years,
        yearlyPrice,
      },
    });

    return {
      licenseId: license.id,
      tenantId: tenant.id,
      tier: plan.code,
      years,
      yearlyPrice,
      monthlyPrice: monthlyEquivalent(yearlyPrice),
      termTotal: termTotal(yearlyPrice, years),
      expiresAt: termEndsAt,
    };
  }

  /**
   * Applies a tier's portals to the school: the portals the tier includes
   * are switched on, the others off. The tier is the entitlement, so a
   * tier change rewrites the school's switches.
   */
  private async syncPortals(tenantId: string, included: string[]) {
    const includedSet = new Set(included);

    const existing = await this.prisma.tenantModule.findMany({
      where: { tenantId },
      select: { module: true },
    });

    for (const module of existing) {
      if (!includedSet.has(module.module)) {
        await this.prisma.tenantModule.upsert({
          where: { tenantId_module: { tenantId, module: module.module } },
          create: { tenantId, module: module.module, enabled: false },
          update: { enabled: false },
        });
      }
    }

    for (const module of included) {
      await this.prisma.tenantModule.upsert({
        where: { tenantId_module: { tenantId, module: module as never } },
        create: { tenantId, module: module as never, enabled: true },
        update: { enabled: true },
      });
    }
  }

  private async tenantWithLicenses(tenantId: string, licenseId?: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        status: true,
        lockedAt: true,
        lockReason: true,
        licenses: {
          where: licenseId ? { id: licenseId } : undefined,
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            startedAt: true,
            expiresAt: true,
            terminatedAt: true,
            yearlyPrice: true,
            plan: {
              select: {
                id: true,
                code: true,
                name: true,
                price: true,
                durationDays: true,
              },
            },
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException('School not found');
    return tenant;
  }

  private assertTierInput(input: TierInput) {
    if (!CODE_PATTERN.test(input.code ?? '')) {
      throw new BadRequestException(
        'A tier code may only contain uppercase letters, digits, hyphens, and underscores',
      );
    }
    if (!input.name?.trim()) {
      throw new BadRequestException('A tier name is required');
    }
    if (!Number.isFinite(input.price) || input.price < 0) {
      throw new BadRequestException('The price cannot be negative');
    }
    if (!Number.isInteger(input.durationDays) || input.durationDays <= 0) {
      throw new BadRequestException('The term must be a positive number of days');
    }
    // A tier is a year that ends. A plan that never ends is a plan the
    // platform cannot charge for again.
    if (input.billingModel !== 'ANNUAL') {
      throw new BadRequestException(
        'A tier is billed yearly. The term length is set by the number of days.',
      );
    }
  }

  private toTier(plan: {
    id: string;
    code: string;
    name: string;
    tier: string | null;
    target: string | null;
    billingModel: string;
    price: unknown;
    currency: string;
    durationDays: number;
    sortOrder: number;
    includedModules: string[];
    features: unknown;
    isActive: boolean;
  }) {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      tier: plan.tier,
      target: plan.target,
      billingModel: plan.billingModel,
      price: Number(plan.price),
      // The yearly price a school pays, and the monthly equivalent the
      // console shows beside it.
      monthlyPrice: monthlyEquivalent(Number(plan.price)),
      currency: plan.currency,
      durationDays: plan.durationDays,
      sortOrder: plan.sortOrder,
      includedModules: plan.includedModules,
      features: (plan.features ?? {}) as Record<string, boolean | number | string>,
      isActive: plan.isActive,
    };
  }

  private async audit(
    actor: PlatformActor,
    entry: {
      action: string;
      entityType: string;
      entityId?: string;
      tenantId?: string;
      oldValues?: unknown;
      newValues?: unknown;
    },
  ) {
    await this.prisma.platformAuditLog.create({
      data: {
        actorId: actor.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        tenantId: entry.tenantId,
        oldValues: entry.oldValues as never,
        newValues: entry.newValues as never,
        ipAddress: actor.ip,
        userAgent: actor.userAgent?.slice(0, 255),
      },
    });
  }
}
