import * as bcrypt from 'bcrypt';
import { MembershipsService } from './memberships.service';
import type { PrismaService } from '../prisma/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('MembershipsService.provisionAcademicAdmin', () => {
  it('creates an academic admin membership and hashes the initial password', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 'academic-user',
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
        })),
      },
      tenantMembership: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 'academic-membership',
          ...data,
        })),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 'academic-role',
          ...data,
        })),
      },
      membershipRole: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const service = new MembershipsService(prisma);

    const result = await service.provisionAcademicAdmin(tenantId, {
      firstName: 'Academic',
      lastName: 'Admin',
      email: 'academic@example.test',
      password: 'InitialPass123!',
    });
    const userData = tx.user.create.mock.calls[0][0].data;

    expect(await bcrypt.compare('InitialPass123!', userData.passwordHash as string)).toBe(true);
    expect(userData.passwordHash).not.toBe('InitialPass123!');
    expect(tx.role.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ slug: 'ACADEMIC_ADMIN' }) }));
    expect(tx.membershipRole.create).toHaveBeenCalledWith({ data: { membershipId: 'academic-membership', roleId: 'academic-role' } });
    expect(result).toEqual(expect.objectContaining({ initialPassword: 'InitialPass123!' }));
    expect(result.user).not.toHaveProperty('passwordHash');
  });
});

describe('MembershipsService.provisionTeacher', () => {
  it('rejects a duplicate email before creating a user', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing-user' }),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const service = new MembershipsService(prisma);

    await expect(service.provisionTeacher(tenantId, {
      firstName: 'Teacher',
      email: 'duplicate@example.test',
    })).rejects.toThrow('Email already registered');
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate employee number before creating a teacher', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'teacher-user' }),
      },
      tenantMembership: { create: jest.fn().mockResolvedValue({ id: 'teacher-membership' }) },
      role: { findFirst: jest.fn().mockResolvedValue({ id: 'teacher-role', name: 'Teacher', slug: 'TEACHER' }) },
      membershipRole: { create: jest.fn().mockResolvedValue({}) },
      teacher: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-teacher' }),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const service = new MembershipsService(prisma);

    await expect(service.provisionTeacher(tenantId, {
      firstName: 'Teacher',
      email: 'new-teacher@example.test',
      employeeNumber: 'E2E-T-001',
    })).rejects.toThrow('Employee number already exists');
    expect(tx.teacher.create).not.toHaveBeenCalled();
  });
});

describe('MembershipsService.update — self-protection', () => {
  const membership = { id: 'membership-1', tenantId, userId: 'admin-user', status: 'ACTIVE' };

  function harness(findFirst: any) {
    const tx = {
      tenantMembership: {
        update: jest.fn().mockResolvedValue({ ...membership, status: 'INACTIVE' }),
      },
    };
    const prisma = {
      tenantMembership: { findFirst },
      $transaction: jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { prisma, tx };
  }

  it('rejects an admin deactivating their own membership', async () => {
    const { prisma, tx } = harness(jest.fn().mockResolvedValue(membership));
    const service = new MembershipsService(prisma as unknown as PrismaService);

    await expect(
      service.update(tenantId, 'membership-1', { status: 'INACTIVE' }, 'admin-user'),
    ).rejects.toThrow('You cannot change your own membership status');
    expect(tx.tenantMembership.update).not.toHaveBeenCalled();
  });

  it('still allows deactivating other memberships', async () => {
    const { prisma, tx } = harness(jest.fn().mockResolvedValue(membership));
    const service = new MembershipsService(prisma as unknown as PrismaService);

    const result = await service.update(tenantId, 'membership-1', { status: 'INACTIVE' }, 'someone-else');
    expect(result.status).toBe('INACTIVE');
    expect(tx.tenantMembership.update).toHaveBeenCalledWith({
      where: { id: 'membership-1' },
      data: { status: 'INACTIVE' },
    });
  });

  it('rejects changing own status even to INVITED, but allows re-activation', async () => {
    const { prisma } = harness(jest.fn().mockResolvedValue({ ...membership, status: 'INACTIVE' }));
    const svcInvited = new MembershipsService(prisma as unknown as PrismaService);
    await expect(
      svcInvited.update(tenantId, 'membership-1', { status: 'INVITED' }, 'admin-user'),
    ).rejects.toThrow('You cannot change your own membership status');

    const { prisma: p2 } = harness(jest.fn().mockResolvedValue({ ...membership, status: 'INVITED' }));
    const svcReactivate = new MembershipsService(p2 as unknown as PrismaService);
    await expect(
      svcReactivate.update(tenantId, 'membership-1', { status: 'ACTIVE' }, 'admin-user'),
    ).resolves.toBeDefined();
  });

  it('throws when membership does not exist in the tenant', async () => {
    const { prisma } = harness(jest.fn().mockResolvedValue(null));
    const service = new MembershipsService(prisma as unknown as PrismaService);

    await expect(
      service.update(tenantId, 'nope', { status: 'INACTIVE' }, 'admin-user'),
    ).rejects.toThrow('Membership not found');
  });
});
