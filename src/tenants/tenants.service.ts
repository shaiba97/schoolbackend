import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async create(userId: string, dto: CreateTenantDto) {
    const slug = dto.slug || this.slugify(dto.name);

    const existing = await this.prisma.tenant.findUnique({
      where: { slug },
    });
    if (existing) {
      throw new ConflictException('Tenant slug already exists');
    }

    const [tenant] = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug,
          email: dto.email,
          phone: dto.phone,
          countryCode: dto.countryCode,
          currencyCode: dto.currencyCode || 'SDG',
          timezone: dto.timezone || 'UTC',
        },
      });

      const membership = await tx.tenantMembership.create({
        data: {
          tenantId: tenant.id,
          userId,
          status: 'ACTIVE',
        },
      });

      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          name: 'Admin',
          slug: 'ADMIN',
          scope: 'TENANT',
          isSystemRole: true,
        },
      });

      await tx.membershipRole.create({
        data: {
          membershipId: membership.id,
          roleId: role.id,
        },
      });

      return [tenant];
    });

    return tenant;
  }

  async findAll(userId: string) {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      include: {
        tenant: true,
        roles: {
          include: { role: true },
        },
      },
    });

    return memberships.map((m) => ({
      ...m.tenant,
      membershipId: m.id,
      roles: m.roles.map((mr) => ({ id: mr.role.id, name: mr.role.name, slug: mr.role.slug })),
    }));
  }

  async findOne(userId: string, tenantId: string) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        userId,
        tenantId,
        status: 'ACTIVE',
      },
      include: {
        tenant: true,
        roles: {
          include: { role: true },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Tenant not found or you are not a member');
    }

    return {
      ...membership.tenant,
      roles: membership.roles.map((mr) => ({ id: mr.role.id, name: mr.role.name, slug: mr.role.slug })),
    };
  }

  async update(userId: string, tenantId: string, dto: UpdateTenantDto) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        userId,
        tenantId,
        status: 'ACTIVE',
      },
      include: {
        roles: {
          include: { role: true },
          where: { role: { slug: 'ADMIN' } },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Tenant not found or you are not a member');
    }

    if (membership.roles.length === 0) {
      throw new ForbiddenException('Only admins can update a tenant');
    }

    if (dto.slug) {
      const existing = await this.prisma.tenant.findFirst({
        where: {
          slug: dto.slug,
          id: { not: tenantId },
        },
      });
      if (existing) {
        throw new ConflictException('Tenant slug already exists');
      }
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: dto.name,
        slug: dto.slug,
        email: dto.email,
        phone: dto.phone,
        countryCode: dto.countryCode,
        currencyCode: dto.currencyCode,
        timezone: dto.timezone,
      },
    });
  }

  async remove(userId: string, tenantId: string, confirm?: string) {
    if (String(confirm) !== 'true') {
      throw new BadRequestException(
        'Destructive action requires confirm=true query parameter',
      );
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        userId,
        tenantId,
        status: 'ACTIVE',
      },
      include: {
        roles: {
          where: { role: { slug: 'ADMIN' } },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Tenant not found or you are not a member');
    }

    if (membership.roles.length === 0) {
      throw new ForbiddenException('Only admins can delete a tenant');
    }

    await this.prisma.tenant.delete({
      where: { id: tenantId },
    });

    return { deleted: true };
  }
}
