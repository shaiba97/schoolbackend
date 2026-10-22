import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PortalModule } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformActor } from './platform-tenants.service';
import { marketDefaults } from './platform-markets';
import { monthlyEquivalent, termTotal } from './platform-pricing';

export type ProvisionTenantInput = {
  name: string;
  nameAr?: string;
  countryCode: string;
  email?: string;
  phone?: string;
  adminName: string;
  adminEmail: string;
  adminPhone?: string;
  adminPassword: string;
  planCode?: string;
  years?: number;
  studentCount?: number;
};

/** Feature flags a freshly provisioned school starts from, all off. */
const DEFAULT_FEATURE_FLAGS: Record<string, boolean> = {
  'portal.transport.tracking': false,
  'notifications.whatsapp': false,
  'compliance.vat': false,
  'payments.bankak': false,
  'payments.mada_knet': false,
};

const ALL_MODULES: PortalModule[] = [
  'ADMIN',
  'ACADEMIC',
  'FINANCIAL',
  'TEACHER',
  'GUARDIAN',
  'STUDENT',
  'TRANSPORT',
  'RECEPTION',
];

/**
 * Provisions a new school in one transaction: tenant, administrator account
 * with a staff ID, membership with the ADMIN role, every portal switched on,
 * the feature flags, and the first license.
 *
 * Three decisions live here rather than in the console, so a school ends up
 * the same whoever provisions it:
 *
 * - The market decides the currency and the timezone.
 * - The slug is derived from the school name, so nobody has to invent one.
 * - The tier price is the yearly amount. The term runs for whole years, and
 *   the monthly figure the console shows is derived from the yearly one.
 */
@Injectable()
export class PlatformProvisioningService {
  constructor(private prisma: PrismaService) {}

  async provision(input: ProvisionTenantInput, actor: PlatformActor) {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('This action requires super admin access');
    }

    this.assertStrongPassword(input.adminPassword);

    const name = input.name.trim();
    const nameAr = input.nameAr?.trim() || null;
    const adminEmail = input.adminEmail.trim().toLowerCase();
    const [adminFirstName, ...adminRest] = input.adminName.trim().split(' ');
    const adminLastName = adminRest.join(' ') || undefined;
    const studentCount = input.studentCount ?? 0;
    const years = input.years ?? 1;
    const { currency, timezone } = marketDefaults(input.countryCode);

    // Hashing before the transaction keeps the pooled connection free while
    // bcrypt does its ~100ms of work.
    const passwordHash = await bcrypt.hash(input.adminPassword, 10);

    const plan = input.planCode
      ? await this.prisma.platformPlan.findUnique({
          where: { code: input.planCode },
        })
      : null;
    if (input.planCode && !plan) {
      throw new NotFoundException('Plan not found');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: adminEmail },
      });
      if (existingUser) {
        throw new ConflictException(
          'The administrator email is already in use',
        );
      }

      const slug = await this.uniqueSlug(tx, name);

      const tenant = await tx.tenant.create({
        data: {
          name,
          nameAr,
          slug,
          email: input.email?.trim(),
          phone: input.phone?.trim(),
          countryCode: input.countryCode.trim().toUpperCase(),
          currencyCode: currency,
          timezone,
          status: 'ACTIVE',
        },
      });

      const user = await tx.user.create({
        data: {
          email: adminEmail,
          firstName: adminFirstName || 'Administrator',
          lastName: adminLastName,
          phone: input.adminPhone?.trim(),
          staffNumber: await this.nextStaffNumber(tx),
          passwordHash,
        },
      });

      const membership = await tx.tenantMembership.create({
        data: { tenantId: tenant.id, userId: user.id, status: 'ACTIVE' },
      });

      const role =
        (await tx.role.findFirst({
          where: { tenantId: tenant.id, slug: 'ADMIN' },
        })) ??
        (await tx.role.create({
          data: {
            tenantId: tenant.id,
            name: 'Admin',
            slug: 'ADMIN',
            scope: 'TENANT',
            isSystemRole: true,
          },
        }));

      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: role.id },
      });

      // Every portal and every flag: the tier decides what a school pays
      // for, not which parts of the product it is allowed to switch on.
      await tx.tenantModule.createMany({
        data: ALL_MODULES.map((module) => ({
          tenantId: tenant.id,
          module,
          enabled: true,
        })),
      });

      await tx.tenantFeatureFlag.createMany({
        data: Object.entries(DEFAULT_FEATURE_FLAGS).map(([key, enabled]) => ({
          tenantId: tenant.id,
          key,
          enabled,
        })),
      });

      const license = plan
        ? await tx.tenantLicense.create({
            data: {
              tenantId: tenant.id,
              planId: plan.id,
              status: 'ACTIVE',
              startedAt: new Date(),
              expiresAt: new Date(
                Date.now() + years * 365 * 24 * 60 * 60 * 1000,
              ),
              seats: studentCount > 0 ? studentCount : null,
              // The licence carries the yearly rate so a quoted tier can bill
              // its own price.
              yearlyPrice: Number(plan.price),
            },
          })
        : null;

      return { tenant, user, license, plan, slug };
    });

    // The tier price is the yearly amount; the monthly figure beside it is
    // what the school pays spread over the year.
    const yearlyUsd = plan ? Number(plan.price) : 0;
    const monthlyUsd = monthlyEquivalent(yearlyUsd);
    const termTotalUsd = termTotal(yearlyUsd, years);

    await this.prisma.platformAuditLog.create({
      data: {
        actorId: actor.id,
        action: 'tenant.provisioned',
        entityType: 'tenant',
        entityId: created.tenant.id,
        tenantId: created.tenant.id,
        newValues: {
          name: created.tenant.name,
          slug: created.slug,
          countryCode: input.countryCode.trim().toUpperCase(),
          currencyCode: currency,
          adminEmail,
          staffNumber: created.user.staffNumber,
          planCode: created.plan?.code ?? null,
          studentCount,
          years,
          yearlyUsd,
          monthlyUsd,
          termTotalUsd,
        },
        ipAddress: actor.ip,
        userAgent: actor.userAgent?.slice(0, 255),
      },
    });

    return {
      tenant: {
        id: created.tenant.id,
        name: created.tenant.name,
        nameAr: created.tenant.nameAr,
        slug: created.tenant.slug,
        countryCode: created.tenant.countryCode,
        currencyCode: created.tenant.currencyCode,
        timezone: created.tenant.timezone,
        status: created.tenant.status,
      },
      admin: {
        id: created.user.id,
        email: created.user.email,
        firstName: created.user.firstName,
        lastName: created.user.lastName ?? null,
        phone: created.user.phone ?? null,
        staffNumber: created.user.staffNumber ?? null,
      },
      license: created.license
        ? {
            id: created.license.id,
            planCode: created.plan?.code ?? null,
            studentCount: created.license.seats ?? 0,
            years,
            yearlyUsd,
            monthlyUsd,
            termTotalUsd,
          }
        : null,
      modules: ALL_MODULES,
      featureFlags: DEFAULT_FEATURE_FLAGS,
    };
  }

  /**
   * Derives a slug from the school name and keeps it unique. Two schools
   * with the same name are normal; the second one gets a numbered suffix
   * rather than a conflict.
   */
  private async uniqueSlug(tx: any, name: string): Promise<string> {
    const base = this.slugify(name) || 'school';
    const taken = new Set(
      (
        await tx.tenant.findMany({
          where: { slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((row: { slug: string }) => row.slug),
    );
    if (!taken.has(base)) return base;

    let suffix = 2;
    while (taken.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  /**
   * Staff IDs for school administrators: STF plus a sequence, walked forward
   * while the number is taken so a deletion never hands out a live ID.
   */
  private async nextStaffNumber(tx: any): Promise<string> {
    const prefix = 'STF';
    const existing = await tx.user.findMany({
      where: { staffNumber: { startsWith: prefix } },
      select: { staffNumber: true },
    });
    const taken = new Set(
      existing
        .map((row: { staffNumber: string | null }) => row.staffNumber)
        .filter((value): value is string => Boolean(value)),
    );

    let sequence = taken.size + 1;
    while (taken.has(`${prefix}${String(sequence).padStart(3, '0')}`)) {
      sequence += 1;
    }
    return `${prefix}${String(sequence).padStart(3, '0')}`;
  }

  private assertStrongPassword(password: string) {
    if (!password || password.length < 8) {
      throw new BadRequestException(
        'The administrator password must be at least 8 characters long',
      );
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw new BadRequestException(
        'The administrator password must contain a letter and a number',
      );
    }
  }

  private slugify(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
