import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMembershipDto, UpdateMembershipDto } from './dto/membership.dto';
import { CreateAcademicAdminDto } from './dto/create-academic-admin.dto';
import { PaginatedResult } from '../common/pagination/pagination.dto';
import { generateTeacherEmployeeNumber } from '../teachers/employee-number';
import * as bcrypt from 'bcrypt';

@Injectable()
export class MembershipsService {
  constructor(private prisma: PrismaService) {}

  private generatePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async provisionAcademicAdmin(tenantId: string, dto: CreateAcademicAdminDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: dto.email } });
      if (existing) throw new ConflictException('Email already registered');

      const user = await tx.user.create({
        data: {
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          passwordHash,
        },
        select: { id: true, email: true, firstName: true, lastName: true },
      });
      const membership = await tx.tenantMembership.create({
        data: { tenantId, userId: user.id, status: 'ACTIVE' },
        select: { id: true, tenantId: true, userId: true, status: true },
      });
      let role = await tx.role.findFirst({
        where: { tenantId, slug: 'ACADEMIC_ADMIN' },
        select: { id: true, name: true, slug: true },
      });
      if (!role) {
        role = await tx.role.create({
          data: { tenantId, name: 'Academic Affairs', slug: 'ACADEMIC_ADMIN', scope: 'TENANT' },
          select: { id: true, name: true, slug: true },
        });
      }
      await tx.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });

      return {
        user,
        membership,
        role,
        initialPassword: dto.password,
      };
    });
  }

  async create(tenantId: string, dto: CreateMembershipDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.prisma.tenantMembership.findFirst({
      where: { tenantId, userId: dto.userId },
    });
    if (existing) {
      throw new ConflictException('User is already a member of this tenant');
    }

    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.tenantMembership.create({
        data: { tenantId, userId: dto.userId, status: 'ACTIVE' },
      });

      if (dto.roleSlug) {
        const role = await tx.role.findFirst({
          where: { tenantId, slug: dto.roleSlug },
        });
        if (role) {
          await tx.membershipRole.create({
            data: { membershipId: membership.id, roleId: role.id },
          });
        }
      }

      return membership;
    });
  }

  async findAll(tenantId: string, page = 1, limit = 50): Promise<PaginatedResult<any>> {
    const skip = (page - 1) * limit;
    const where = { tenantId };
    const [data, total] = await Promise.all([
      this.prisma.tenantMembership.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          roles: {
            include: { role: { select: { id: true, name: true, slug: true } } },
          },
        },
        orderBy: { joinedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.tenantMembership.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async update(
    tenantId: string,
    membershipId: string,
    dto: UpdateMembershipDto,
    currentUserId?: string,
  ) {
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    if (
      currentUserId &&
      dto.status &&
      dto.status !== 'ACTIVE' &&
      membership.userId === currentUserId
    ) {
      throw new ForbiddenException('You cannot change your own membership status');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tenantMembership.update({
        where: { id: membershipId },
        data: { status: dto.status },
      });

      if (dto.roleSlug) {
        const role = await tx.role.findFirst({
          where: { tenantId, slug: dto.roleSlug },
        });
        if (role) {
          await tx.membershipRole.deleteMany({ where: { membershipId } });
          await tx.membershipRole.create({
            data: { membershipId, roleId: role.id },
          });
        }
      }

      return updated;
    });
  }

  async provisionTeacher(
    tenantId: string,
    data: { firstName: string; lastName?: string; email?: string; phone?: string; employeeNumber?: string; password?: string },
  ) {
    const email = data.email || `teacher-${Date.now()}@school.local`;
    const password = data.password || this.generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new ConflictException('Email already registered');

      const user = await tx.user.create({
        data: {
          email,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          passwordHash,
        },
      });

      const membership = await tx.tenantMembership.create({
        data: { tenantId, userId: user.id, status: 'ACTIVE' },
      });

      let role = await tx.role.findFirst({
        where: { tenantId, slug: 'TEACHER' },
      });
      if (!role) {
        role = await tx.role.create({
          data: { tenantId, name: 'Teacher', slug: 'TEACHER', scope: 'TENANT' },
        });
      }
      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: role.id },
      });

      const explicitNumber = data.employeeNumber?.trim() || undefined;
      if (explicitNumber) {
        const existingTeacher = await tx.teacher.findFirst({
          where: { tenantId, employeeNumber: explicitNumber },
          select: { id: true },
        });
        if (existingTeacher) throw new ConflictException('Employee number already exists');
      }

      let employeeNumber = explicitNumber;
      if (!employeeNumber) {
        // Auto-design the employee ID when none is provided (e.g. `26CPM001`).
        // Provisioned teachers carry no department, so the GEN fallback applies.
        employeeNumber = await generateTeacherEmployeeNumber(tx, tenantId, null);
      }

      try {
        const teacher = await tx.teacher.create({
          data: {
            tenantId,
            userId: user.id,
            employeeNumber,
          },
        });

        return { user: { id: user.id, email, password }, teacher, membership };
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('Employee number already exists');
        }
        throw error;
      }
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  async provisionStudent(
    tenantId: string,
    data: { firstName: string; lastName?: string; email?: string; roleNumber: string },
  ) {
    const password = this.generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);

    return this.prisma.$transaction(async (tx) => {
      if (data.email) {
        const existing = await tx.user.findUnique({ where: { email: data.email } });
        if (existing) throw new ConflictException('Email already registered');
      }
      const user = await tx.user.create({
        data: {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          passwordHash,
        },
      });

      const membership = await tx.tenantMembership.create({
        data: { tenantId, userId: user.id, status: 'ACTIVE' },
      });

      let role = await tx.role.findFirst({
        where: { tenantId, slug: 'STUDENT' },
      });
      if (!role) {
        role = await tx.role.create({
          data: { tenantId, name: 'Student', slug: 'STUDENT', scope: 'TENANT' },
        });
      }
      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: role.id },
      });

      const student = await tx.student.create({
        data: {
          tenantId,
          userId: user.id,
          firstName: data.firstName,
          lastName: data.lastName,
          roleNumber: data.roleNumber,
        },
      });

      return { user: { id: user.id, email: data.email, password }, student, membership };
    });
  }

  async provisionGuardian(
    tenantId: string,
    data: { firstName: string; lastName?: string; email?: string; phone?: string },
  ) {
    const email = data.email || `parent-${Date.now()}@school.local`;
    const password = this.generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          passwordHash,
        },
      });

      const membership = await tx.tenantMembership.create({
        data: { tenantId, userId: user.id, status: 'ACTIVE' },
      });

      let role = await tx.role.findFirst({
        where: { tenantId, slug: 'PARENT' },
      });
      if (!role) {
        role = await tx.role.create({
          data: { tenantId, name: 'Parent', slug: 'PARENT', scope: 'TENANT' },
        });
      }
      await tx.membershipRole.create({
        data: { membershipId: membership.id, roleId: role.id },
      });

      const guardian = await tx.guardian.create({
        data: {
          tenantId,
          userId: user.id,
          firstName: data.firstName,
          lastName: data.lastName,
          email,
          phone: data.phone,
        },
      });

      return { user: { id: user.id, email, password }, guardian, membership };
    });
  }
}
