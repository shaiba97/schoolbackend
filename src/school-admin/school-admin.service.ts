import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PortalModule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  allowedPositions,
  POSITION_LABELS,
  tierPortalsFor,
} from '../staff/position-portals';
import { STAFF_POSITIONS } from '../staff/dto/staff.dto';
import { monthlyEquivalent, termTotal } from '../platform/platform-pricing';

const ALL_PORTALS: PortalModule[] = [
  PortalModule.ADMIN,
  PortalModule.ACADEMIC,
  PortalModule.FINANCIAL,
  PortalModule.TEACHER,
  PortalModule.GUARDIAN,
  PortalModule.STUDENT,
  PortalModule.TRANSPORT,
  PortalModule.RECEPTION,
];

/**
 * The school administrator's own workspace: their profile, their school, the
 * plan they pay for, and the positions they may staff.
 *
 * Everything here is scoped to the tenant in the request. The administrator
 * never names a school: the tenant comes from the session, so one admin
 * cannot read or change another school's data by changing an id.
 */
@Injectable()
export class SchoolAdminService {
  constructor(private prisma: PrismaService) {}

  /**
   * Everything the admin profile page shows, in one call: the person, the
   * school, the subscription, the portals the plan grants, the positions the
   * school holds, and the positions it may still create.
   */
  async overview(tenantId: string, userId: string) {
    const [admin, tenant, licence, positions, plans] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: userId, status: { not: 'DELETED' } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          avatarUrl: true,
          staffNumber: true,
          status: true,
          lastLoginAt: true,
        },
      }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          nameAr: true,
          email: true,
          phone: true,
          logoUrl: true,
          websiteUrl: true,
          countryCode: true,
          currencyCode: true,
          timezone: true,
          weekendDays: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.tenantLicense.findFirst({
        where: { tenantId, status: { in: ['ACTIVE', 'DUE', 'EXPIRED'] } },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          status: true,
          startedAt: true,
          expiresAt: true,
          seats: true,
          yearlyPrice: true,
          terminatedAt: true,
          terminationReason: true,
          plan: {
            select: {
              id: true,
              code: true,
              name: true,
              tier: true,
              price: true,
              currency: true,
              durationDays: true,
              includedModules: true,
            },
          },
        },
      }),
      this.prisma.role.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          portal: true,
          isSystemRole: true,
          _count: { select: { memberships: true } },
        },
      }),
      // The tiers a school could ask to move to, so the request dialog shows
      // real plans with real prices rather than a free-text wish.
      this.prisma.platformPlan.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          tier: true,
          price: true,
          currency: true,
          durationDays: true,
          includedModules: true,
        },
      }),
    ]);

    if (!tenant) throw new NotFoundException('School not found');
    if (!admin) throw new NotFoundException('User not found');

    const tierPortals = licence?.plan.includedModules ?? null;
    const expiresAt = licence?.expiresAt ?? null;
    const daysRemaining = expiresAt
      ? Math.floor((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;

    const subscriptionStatus = this.subscriptionStatus(
      licence?.status,
      daysRemaining,
    );

    return {
      admin: {
        id: admin.id,
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        phone: admin.phone,
        avatarUrl: admin.avatarUrl,
        staffNumber: admin.staffNumber,
        status: admin.status,
        lastLoginAt: admin.lastLoginAt,
        role: 'SCHOOL_ADMIN',
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        nameAr: tenant.nameAr,
        email: tenant.email,
        phone: tenant.phone,
        logoUrl: tenant.logoUrl,
        websiteUrl: tenant.websiteUrl,
        countryCode: tenant.countryCode,
        currencyCode: tenant.currencyCode,
        timezone: tenant.timezone,
        weekendDays: tenant.weekendDays,
        status: tenant.status,
        createdAt: tenant.createdAt,
      },
      subscription: licence
        ? {
            id: licence.id,
            tier: licence.plan.code,
            tierName: licence.plan.name,
            tierLabel: licence.plan.tier,
            status: licence.status,
            subscriptionStatus,
            startedAt: licence.startedAt,
            expiresAt: licence.expiresAt,
            daysRemaining,
            durationDays: licence.plan.durationDays,
            studentCount: licence.seats ?? 0,
            // The yearly rate the school pays, and the monthly equivalent it
            // is spread across.
            yearlyPrice: licence.yearlyPrice
              ? Number(licence.yearlyPrice)
              : Number(licence.plan.price),
            monthlyPrice: monthlyEquivalent(
              licence.yearlyPrice
                ? Number(licence.yearlyPrice)
                : Number(licence.plan.price),
            ),
            currency: licence.plan.currency,
            portals: licence.plan.includedModules,
          }
        : null,
      portals: ALL_PORTALS.map((portal) => ({
        portal,
        unlocked: tierPortals ? tierPortals.includes(portal) : false,
      })),
      allowedPositions: allowedPositions(tierPortals).map((position) => ({
        position,
        label: POSITION_LABELS[position],
      })),
      positions: positions.map((position) => ({
        id: position.id,
        name: position.name,
        slug: position.slug,
        description: position.description,
        portal: position.portal,
        isSystemRole: position.isSystemRole,
        members: position._count.memberships,
      })),
      // The tiers a school could ask to move to. The yearly rate and the
      // monthly equivalent shown are the tier's list, not a quote.
      upgrades: plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        tier: plan.tier,
        yearlyPrice: Number(plan.price),
        monthlyPrice: monthlyEquivalent(Number(plan.price)),
        currency: plan.currency,
        durationDays: plan.durationDays,
        portals: plan.includedModules,
      })),
    };
  }

  async updateProfile(
    userId: string,
    dto: { firstName?: string; lastName?: string; email?: string; phone?: string },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: { not: 'DELETED' } },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
        ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        avatarUrl: true,
        staffNumber: true,
      },
    });

    return updated;
  }

  async updateTenant(
    tenantId: string,
    dto: {
      name?: string;
      nameAr?: string | null;
      email?: string | null;
      phone?: string | null;
      logoUrl?: string | null;
      websiteUrl?: string | null;
      countryCode?: string | null;
      currencyCode?: string;
      timezone?: string;
    },
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('School not found');

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr?.trim() || null } : {}),
        ...(dto.email !== undefined ? { email: dto.email?.trim() || null } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
        ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl?.trim() || null } : {}),
        ...(dto.websiteUrl !== undefined
          ? { websiteUrl: dto.websiteUrl?.trim() || null }
          : {}),
        ...(dto.countryCode !== undefined
          ? { countryCode: dto.countryCode?.trim().toUpperCase() || null }
          : {}),
        ...(dto.currencyCode !== undefined
          ? { currencyCode: dto.currencyCode.trim().toUpperCase() }
          : {}),
        ...(dto.timezone !== undefined
          ? { timezone: dto.timezone.trim() }
          : {}),
      },
      select: {
        id: true,
        name: true,
        nameAr: true,
        email: true,
        phone: true,
        logoUrl: true,
        websiteUrl: true,
        countryCode: true,
        currencyCode: true,
        timezone: true,
        weekendDays: true,
        status: true,
      },
    });
  }

  /**
   * Creates a position (a tenant role) for one of the portals the plan
   * grants. The portal gate is the same one the staff endpoint uses, so a
   * position cannot be created for a portal the school did not buy.
   */
  async createPosition(
    tenantId: string,
    dto: { title: string; portal: PortalModule; description?: string },
  ) {
    const title = dto.title?.trim();
    if (!title) throw new BadRequestException('A position title is required');

    const tierPortals = await tierPortalsFor(this.prisma, tenantId);
    if (tierPortals && !tierPortals.includes(dto.portal)) {
      throw new ForbiddenException(
        `Your plan does not include the ${dto.portal.toLowerCase()} portal, so this position cannot be created. Upgrade the plan to add it.`,
      );
    }

    const slug = `CUSTOM_${title.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`.slice(0, 100);
    const existing = await this.prisma.role.findFirst({
      where: { tenantId, name: title },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('This school already has a position with that title');
    }

    return this.prisma.role.create({
      data: {
        tenantId,
        name: title,
        slug,
        description: dto.description?.trim() || null,
        scope: 'TENANT',
        portal: dto.portal,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        portal: true,
        isSystemRole: true,
      },
    });
  }

  async deletePosition(tenantId: string, id: string) {
    const position = await this.prisma.role.findFirst({
      where: { id, tenantId },
      select: { id: true, _count: { select: { memberships: true } } },
    });
    if (!position) throw new NotFoundException('Position not found');
    if (position._count.memberships > 0) {
      throw new BadRequestException(
        'This position still has people in it. Move them first, then delete it.',
      );
    }
    await this.prisma.role.delete({ where: { id } });
    return { id, deleted: true };
  }

  /**
   * A request to change tier, recorded for the platform console to answer.
   * A school cannot change its own plan - only the platform can - so this is
   * a request, not an action.
   */
  async requestTierChange(
    tenantId: string,
    userId: string,
    dto: { planId: string; years?: number; note?: string },
  ) {
    const plan = await this.prisma.platformPlan.findUnique({
      where: { id: dto.planId },
      select: { id: true, code: true, name: true, price: true, currency: true },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    // A term is whole years, and a year is the shortest one.
    const years = dto.years ?? 1;
    if (!Number.isInteger(years) || years < 1 || years > 10) {
      throw new BadRequestException(
        'The subscription term runs from one to ten years.',
      );
    }
    const yearlyPrice = Number(plan.price);
    const monthlyPrice = monthlyEquivalent(yearlyPrice);

    const audit = await this.prisma.platformAuditLog.create({
      data: {
        action: 'tenant.tier_change_requested',
        entityType: 'tenant',
        entityId: tenantId,
        tenantId,
        newValues: {
          requestedPlan: plan.code,
          requestedPlanId: plan.id,
          requestedBy: userId,
          requestedYears: years,
          requestedYearlyPrice: yearlyPrice,
          requestedMonthlyPrice: monthlyPrice,
          requestedTermTotal: termTotal(yearlyPrice, years),
          note: dto.note?.trim() || null,
        },
      },
    });

    return {
      requested: true,
      plan: { id: plan.id, code: plan.code, name: plan.name },
      years,
      yearlyPrice,
      monthlyPrice,
      termTotal: termTotal(yearlyPrice, years),
      currency: plan.currency,
      requestedAt: audit.createdAt,
    };
  }

  private subscriptionStatus(
    licenceStatus: string | undefined,
    daysRemaining: number | null,
  ): 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'LOCKED' | 'NO_SUBSCRIPTION' {
    if (!licenceStatus) return 'NO_SUBSCRIPTION';
    if (licenceStatus === 'SUSPENDED') return 'LOCKED';
    if (licenceStatus === 'EXPIRED') return 'EXPIRED';
    if (daysRemaining !== null && daysRemaining < 0) return 'EXPIRED';
    if (daysRemaining !== null && daysRemaining <= 30) return 'EXPIRING_SOON';
    return 'ACTIVE';
  }
}

export { STAFF_POSITIONS };
