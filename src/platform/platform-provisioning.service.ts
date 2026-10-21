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

export type ProvisionTenantInput = {
  name: string;
  slug?: string;
  email?: string;
  phone?: string;
  countryCode?: string;
  currencyCode?: string;
  timezone?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  planCode?: string;
  modules?: string[];
  featureFlags?: Record<string, boolean>;
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
];

/**
 * Provisions a new school in one transaction: tenant, administrator account,
 * membership with the ADMIN role, portal switches, feature flags, and the
 * first license. Anything less would leave a school that nobody can sign in
 * to, which is the failure mode this endpoint exists to prevent.
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
    const slug = (input.slug?.trim() || this.slugify(name)).toLowerCase();
    const adminEmail = input.adminEmail.trim().toLowerCase();
    const [adminFirstName, ...adminRest] = input.adminName.trim().split(' ');
    const adminLastName = adminRest.join(' ') || undefined;

    const modules = (
      input.modules?.length ? input.modules : ALL_MODULES
    ).filter((module): module is PortalModule =>
      ALL_MODULES.includes(module as PortalModule),
    );
    const featureFlags = {
      ...DEFAULT_FEATURE_FLAGS,
      ...(input.featureFlags ?? {}),
    };

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
      const existingTenant = await tx.tenant.findUnique({ where: { slug } });
      if (existingTenant) {
        throw new ConflictException('A school with this slug already exists');
      }

      const existingUser = await tx.user.findUnique({
        where: { email: adminEmail },
      });
      if (existingUser) {
        throw new ConflictException(
          'The administrator email is already in use',
        );
      }

      const tenant = await tx.tenant.create({
        data: {
          name,
          slug,
          email: input.email?.trim(),
          phone: input.phone?.trim(),
          countryCode: input.countryCode?.trim().toUpperCase(),
          currencyCode: input.currencyCode?.trim().toUpperCase() || 'SDG',
          timezone: input.timezone?.trim() || 'UTC',
          status: 'ACTIVE',
        },
      });

      const user = await tx.user.create({
        data: {
          email: adminEmail,
          firstName: adminFirstName || 'Administrator',
          lastName: adminLastName,
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

      await tx.tenantModule.createMany({
        data: modules.map((module) => ({
          tenantId: tenant.id,
          module,
          enabled: true,
        })),
      });

      await tx.tenantFeatureFlag.createMany({
        data: Object.entries(featureFlags).map(([key, enabled]) => ({
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
            },
          })
        : null;

      return { tenant, user, license, plan, modules };
    });

    await this.prisma.platformAuditLog.create({
      data: {
        actorId: actor.id,
        action: 'tenant.provisioned',
        entityType: 'tenant',
        entityId: created.tenant.id,
        tenantId: created.tenant.id,
        newValues: {
          name: created.tenant.name,
          slug: created.tenant.slug,
          adminEmail,
          planCode: created.plan?.code ?? null,
          modules: created.modules,
        },
        ipAddress: actor.ip,
        userAgent: actor.userAgent?.slice(0, 255),
      },
    });

    return {
      tenant: {
        id: created.tenant.id,
        name: created.tenant.name,
        slug: created.tenant.slug,
        status: created.tenant.status,
      },
      admin: {
        id: created.user.id,
        email: created.user.email,
        firstName: created.user.firstName,
        lastName: created.user.lastName ?? null,
      },
      license: created.license
        ? { id: created.license.id, planCode: created.plan?.code ?? null }
        : null,
      modules: created.modules,
      featureFlags,
    };
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
