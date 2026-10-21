import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PlatformActor = {
  id: string;
  userId: string;
  role: 'SUPER_ADMIN' | 'SUPPORT';
  ip?: string;
  userAgent?: string;
};

export type PlatformListQuery = {
  search?: string;
  status?: string;
  plan?: string;
  page?: number;
  limit?: number;
};

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Status transitions a platform operator may apply to a school. ARCHIVED is
 * the terminal state: delete is archive only, so a school can never be
 * un-deleted through the console.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ['TRIAL', 'PENDING', 'SUSPENDED', 'ARCHIVED'],
  TRIAL: ['ACTIVE', 'PENDING', 'SUSPENDED', 'ARCHIVED'],
  PENDING: ['ACTIVE', 'TRIAL', 'SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

/**
 * Cross-tenant read/write surface for the control plane. Every mutation runs
 * outside a tenant transaction on purpose: platform operations are global by
 * definition and must not inherit a tenant's RLS/GUC context.
 */
@Injectable()
export class PlatformTenantsService {
  constructor(private prisma: PrismaService) {}

  async stats() {
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [byStatus, total, newSchools, activeLicenses, annualLicenses, revenue, dueInvoices, expiring] =
      await Promise.all([
        this.prisma.tenant.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.tenant.count(),
        this.prisma.tenant.count({ where: { createdAt: { gte: last30Days } } }),
        this.prisma.tenantLicense.count({ where: { status: 'ACTIVE' } }),
        this.prisma.tenantLicense.findMany({
          where: { status: 'ACTIVE', plan: { billingModel: 'ANNUAL' } },
          include: { plan: { select: { code: true, billingModel: true, price: true } } },
        }),
        this.prisma.platformInvoice.aggregate({
          where: { status: 'PAID' },
          _sum: { amount: true },
        }),
        this.prisma.platformInvoice.count({ where: { status: 'DUE' } }),
        this.prisma.tenantLicense.count({
          where: { status: 'ACTIVE', expiresAt: { gte: now, lt: in30Days } },
        }),
      ]);

    const counts = {
      ACTIVE: 0,
      TRIAL: 0,
      PENDING: 0,
      SUSPENDED: 0,
      ARCHIVED: 0,
    } as Record<string, number>;
    for (const row of byStatus) {
      counts[row.status] = row._count._all;
    }

    const mrr = annualLicenses.reduce((sum, license) => {
      // The query already filters ANNUAL; re-checking here keeps a lifetime
      // license out of recurring revenue even if the filter is ever dropped.
      if (license.plan.billingModel !== 'ANNUAL') return sum;
      const price = Number(license.plan.price);
      return sum + (Number.isFinite(price) ? price / 12 : 0);
    }, 0);

    const revenueTotal = Number(revenue._sum.amount ?? 0);

    return {
      tenants: {
        total,
        ACTIVE: counts.ACTIVE,
        TRIAL: counts.TRIAL,
        PENDING: counts.PENDING,
        SUSPENDED: counts.SUSPENDED,
        ARCHIVED: counts.ARCHIVED,
        newLast30Days: newSchools,
      },
      licensing: {
        activeLicenses,
        mrr: round2(mrr),
        revenue: round2(revenueTotal),
        dueInvoices,
        expiringSoon: expiring,
      },
    };
  }

  async listPlans() {
    const plans = await this.prisma.platformPlan.findMany({
      orderBy: { price: 'asc' },
    });

    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      billingModel: plan.billingModel,
      price: Number(plan.price),
      currency: plan.currency,
      isActive: plan.isActive,
    }));
  }

  async list(query: PlatformListQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(query.limit) || DEFAULT_PAGE_SIZE),
    );
    const search = query.search?.trim();
    const plan = query.plan?.trim();

    const where: Prisma.TenantWhereInput = {};
    if (query.status) {
      where.status = query.status as TenantStatus;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (plan) {
      where.licenses = { some: { plan: { code: plan } } };
    }

    const [rows, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          licenses: {
            where: { status: 'ACTIVE' },
            take: 1,
            orderBy: { startedAt: 'desc' },
            include: { plan: true },
          },
          _count: {
            select: {
              memberships: true,
              modules: { where: { enabled: true } },
            },
          },
        },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      items: rows.map((tenant) => this.toListItem(tenant)),
      total,
      page,
      limit,
      pageCount: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async detail(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        licenses: {
          orderBy: { startedAt: 'desc' },
          include: { plan: true },
        },
        modules: { orderBy: { module: 'asc' } },
        featureFlags: { orderBy: { key: 'asc' } },
        _count: {
          select: { memberships: true, students: true, teachers: true },
        },
      },
    });

    if (!tenant) throw new NotFoundException('School not found');

    const [recentActivity, invoices] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.platformInvoice.findMany({
        where: { tenantId },
        orderBy: { issuedAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      email: tenant.email,
      phone: tenant.phone,
      countryCode: tenant.countryCode,
      currencyCode: tenant.currencyCode,
      timezone: tenant.timezone,
      weekendDays: tenant.weekendDays,
      logoUrl: tenant.logoUrl,
      websiteUrl: tenant.websiteUrl,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      licenses: tenant.licenses.map((license) => ({
        id: license.id,
        status: license.status,
        startedAt: license.startedAt,
        expiresAt: license.expiresAt,
        seats: license.seats,
        notes: license.notes,
        plan: {
          id: license.plan.id,
          code: license.plan.code,
          name: license.plan.name,
          billingModel: license.plan.billingModel,
          price: Number(license.plan.price),
          currency: license.plan.currency,
        },
      })),
      modules: tenant.modules.map((module) => ({
        id: module.id,
        module: module.module,
        enabled: module.enabled,
      })),
      featureFlags: tenant.featureFlags.map((flag) => ({
        id: flag.id,
        key: flag.key,
        enabled: flag.enabled,
      })),
      counts: {
        users: tenant._count.memberships,
        students: tenant._count.students,
        teachers: tenant._count.teachers,
      },
      invoices: invoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        kind: invoice.kind,
        status: invoice.status,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        issuedAt: invoice.issuedAt,
        paidAt: invoice.paidAt,
      })),
      recentActivity: recentActivity.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorId: entry.actorId,
        createdAt: entry.createdAt,
        oldValues: entry.oldValues,
        newValues: entry.newValues,
      })),
    };
  }

  async updateStatus(
    tenantId: string,
    status: string,
    actor: PlatformActor,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true },
    });
    if (!tenant) throw new NotFoundException('School not found');

    if (tenant.status === status) {
      return { id: tenant.id, status: tenant.status, changed: false };
    }

    const allowed = ALLOWED_TRANSITIONS[tenant.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot change a school from ${tenant.status} to ${status}`,
      );
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: status as TenantStatus },
      select: { id: true, status: true },
    });

    await this.audit(actor, {
      action: 'tenant.status.changed',
      entityType: 'tenant',
      entityId: tenantId,
      tenantId,
      oldValues: { status: tenant.status },
      newValues: { status },
    });

    return { id: updated.id, status: updated.status, changed: true };
  }

  async setModule(
    tenantId: string,
    module: string,
    enabled: boolean,
    actor: PlatformActor,
  ) {
    const moduleRecord = await this.prisma.tenantModule.upsert({
      where: { tenantId_module: { tenantId, module: module as never } },
      create: { tenantId, module: module as never, enabled },
      update: { enabled },
    });

    await this.audit(actor, {
      action: 'tenant.module.changed',
      entityType: 'tenant_module',
      entityId: moduleRecord.id,
      tenantId,
      newValues: { module, enabled },
    });

    return {
      id: moduleRecord.id,
      module: moduleRecord.module,
      enabled: moduleRecord.enabled,
    };
  }

  async setFlag(
    tenantId: string,
    key: string,
    enabled: boolean,
    actor: PlatformActor,
  ) {
    const flag = await this.prisma.tenantFeatureFlag.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, enabled },
      update: { enabled },
    });

    await this.audit(actor, {
      action: 'tenant.flag.changed',
      entityType: 'tenant_feature_flag',
      entityId: flag.id,
      tenantId,
      newValues: { key, enabled },
    });

    return { id: flag.id, key: flag.key, enabled: flag.enabled };
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

  private toListItem(tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    email: string | null;
    countryCode: string | null;
    currencyCode: string;
    timezone: string;
    createdAt: Date;
    licenses: Array<{
      id: string;
      status: string;
      expiresAt: Date | null;
      plan: {
        id: string;
        code: string;
        name: string;
        billingModel: string;
        price: unknown;
        currency: string;
      };
    }>;
    _count: { memberships: number; modules: number };
  }) {
    const license = tenant.licenses[0] ?? null;
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      email: tenant.email,
      countryCode: tenant.countryCode,
      currencyCode: tenant.currencyCode,
      timezone: tenant.timezone,
      createdAt: tenant.createdAt,
      users: tenant._count.memberships,
      enabledModules: tenant._count.modules,
      plan: license
        ? {
            id: license.plan.id,
            code: license.plan.code,
            name: license.plan.name,
            billingModel: license.plan.billingModel,
            price: Number(license.plan.price),
            currency: license.plan.currency,
          }
        : null,
      license: license
        ? {
            id: license.id,
            status: license.status,
            expiresAt: license.expiresAt,
          }
        : null,
    };
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
