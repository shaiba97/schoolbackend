import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

// @nestjs/jwt ships ESM only, which this Jest (CommonJS) setup cannot require.
// A factory mock keeps the real module out of the transform pipeline instead of
// widening transformIgnorePatterns for every suite.
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

import { AuthService } from './auth.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';
const phone = '+249912345678';

function membership() {
  return [
    {
      tenantId,
      tenant: { id: tenantId, status: 'ACTIVE' },
      roles: [{ role: { slug: 'TEACHER' } }],
    },
  ];
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: null,
    phone,
    firstName: 'Mazin',
    lastName: 'Cbag',
    avatarUrl: null,
    status: 'ACTIVE' as const,
    createdAt: new Date('2026-01-01'),
    passwordHash: 'hashed',
    memberships: membership(),
    ...overrides,
  };
}

function build(
  findManyResult: unknown[] | { mode: 'many' } = { mode: 'many' },
) {
  const user = {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue(findManyResult),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = { user } as unknown as PrismaService;
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  return { service: new AuthService(prisma, jwt as never), user, jwt };
}

describe('AuthService.login by phone', () => {
  it('normalizes the number and signs in the single matching user', async () => {
    const { service, user, jwt } = build([activeUser()]);

    const result = await service.login({
      phone: '0912345678',
      tenantId,
      password: 'secret',
    });

    expect(user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phone,
          memberships: { some: { tenantId, status: 'ACTIVE' } },
        }),
      }),
    );
    expect(result.accessToken).toBe('token');
    expect(result.user.id).toBe('user-1');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1' }),
    );
  });

  it('scopes the lookup to the given tenant', async () => {
    const { service, user } = build([
      activeUser({
        memberships: [
          {
            tenantId: otherTenantId,
            tenant: { id: otherTenantId, status: 'ACTIVE' },
            roles: [],
          },
        ],
      }),
    ]);

    await service.login({ phone, tenantId, password: 'secret' });

    expect(user.findMany.mock.calls[0][0].where.memberships.some.tenantId).toBe(
      tenantId,
    );
  });

  it('requires a tenantId with a phone', async () => {
    const { service, user } = build();

    await expect(
      service.login({ phone, password: 'secret' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(user.findMany).not.toHaveBeenCalled();
  });

  it('reports an ambiguous number instead of picking one at random', async () => {
    const { service } = build([activeUser(), activeUser({ id: 'user-2' })]);

    await expect(
      service.login({ phone, tenantId, password: 'secret' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects an unknown number with the same message as a bad password', async () => {
    const { service } = build([]);

    await expect(
      service.login({ phone, tenantId, password: 'secret' }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('rejects a wrong password', async () => {
    const bcrypt = require('bcrypt');
    bcrypt.compare.mockResolvedValueOnce(false);
    const { service } = build([activeUser()]);

    await expect(
      service.login({ phone, tenantId, password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an inactive account', async () => {
    const { service } = build([activeUser({ status: 'INACTIVE' })]);

    await expect(
      service.login({ phone, tenantId, password: 'secret' }),
    ).rejects.toThrow('Account is not active');
  });

  it('never looks up by email when a phone is supplied', async () => {
    const { service, user } = build([activeUser()]);

    await service.login({ phone, tenantId, password: 'secret' });

    expect(user.findUnique).not.toHaveBeenCalled();
  });
});

describe('AuthService.login by employee ID', () => {
  const employeeNumber = '26CPM001';

  function buildWithTeacher(teacherResult: unknown) {
    const { service, user, jwt } = build([]);
    const teacher = { findFirst: jest.fn().mockResolvedValue(teacherResult) };
    (service as unknown as { prisma: { teacher: unknown } }).prisma = {
      user,
      teacher,
    } as never;
    user.findUnique.mockResolvedValue(activeUser());
    return { service, user, teacher, jwt };
  }

  it('normalizes the ID and signs in the linked user', async () => {
    const { service, user, teacher, jwt } = buildWithTeacher({
      userId: 'user-1',
    });

    const result = await service.login({
      employeeNumber: ' 26cpm001 ',
      tenantId,
      password: 'secret',
    });

    expect(teacher.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, employeeNumber } }),
    );
    expect(user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect(result.accessToken).toBe('token');
    expect(result.user.id).toBe('user-1');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1' }),
    );
  });

  it('requires a tenantId with an employee ID', async () => {
    const { service, user } = build([]);
    const teacher = { findFirst: jest.fn() };
    (service as unknown as { prisma: unknown }).prisma = {
      user,
      teacher,
    };

    await expect(
      service.login({ employeeNumber, password: 'secret' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(teacher.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an unknown ID with the same message as a bad password', async () => {
    const { service } = buildWithTeacher(null);

    await expect(
      service.login({ employeeNumber, tenantId, password: 'secret' }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('rejects a wrong password', async () => {
    const bcrypt = require('bcrypt');
    bcrypt.compare.mockResolvedValueOnce(false);
    const { service } = buildWithTeacher({ userId: 'user-1' });

    await expect(
      service.login({ employeeNumber, tenantId, password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an inactive account', async () => {
    const { service, user } = buildWithTeacher({ userId: 'user-1' });
    user.findUnique.mockResolvedValue(activeUser({ status: 'INACTIVE' }));

    await expect(
      service.login({ employeeNumber, tenantId, password: 'secret' }),
    ).rejects.toThrow('Account is not active');
  });

  it('never looks up by email or phone when an ID is supplied', async () => {
    const { service, user } = buildWithTeacher({ userId: 'user-1' });

    await service.login({ employeeNumber, tenantId, password: 'secret' });

    const uniqueCalls = user.findUnique.mock.calls as Array<
      [Record<string, unknown>]
    >;
    expect(
      uniqueCalls.every(
        (call) =>
          (call[0].where as Record<string, unknown>).email === undefined,
      ),
    ).toBe(true);
    expect(user.findMany).not.toHaveBeenCalled();
  });
});

describe('AuthService.login by student number', () => {
  const studentNumber = '26CS1R01';

  function buildWithStudent(studentResult: unknown) {
    const { service, user, jwt } = build([]);
    const student = { findFirst: jest.fn().mockResolvedValue(studentResult) };
    (service as unknown as { prisma: { student: unknown } }).prisma = {
      user,
      student,
    } as never;
    user.findUnique.mockResolvedValue(activeUser());
    return { service, user, student, jwt };
  }

  it('matches case-insensitively and signs in the linked user', async () => {
    const { service, user, student, jwt } = buildWithStudent({
      userId: 'user-1',
    });

    const result = await service.login({
      studentNumber: ' 26cs1r01 ',
      tenantId,
      password: 'secret',
    });

    expect(student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          roleNumber: { equals: '26cs1r01', mode: 'insensitive' },
        },
      }),
    );
    expect(user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect(result.accessToken).toBe('token');
    expect(result.user.id).toBe('user-1');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1' }),
    );
  });

  it('requires a tenantId with a student number', async () => {
    const { service, user } = build([]);
    const student = { findFirst: jest.fn() };
    (service as unknown as { prisma: unknown }).prisma = {
      user,
      student,
    };

    await expect(
      service.login({ studentNumber, password: 'secret' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(student.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an unknown number with the same message as a bad password', async () => {
    const { service } = buildWithStudent(null);

    await expect(
      service.login({ studentNumber, tenantId, password: 'secret' }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('rejects a wrong password', async () => {
    const bcrypt = require('bcrypt');
    bcrypt.compare.mockResolvedValueOnce(false);
    const { service } = buildWithStudent({ userId: 'user-1' });

    await expect(
      service.login({ studentNumber, tenantId, password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an inactive account', async () => {
    const { service, user } = buildWithStudent({ userId: 'user-1' });
    user.findUnique.mockResolvedValue(activeUser({ status: 'INACTIVE' }));

    await expect(
      service.login({ studentNumber, tenantId, password: 'secret' }),
    ).rejects.toThrow('Account is not active');
  });

  it('never looks up by email, phone, or employee ID when a student number is supplied', async () => {
    const { service, user } = buildWithStudent({ userId: 'user-1' });

    await service.login({ studentNumber, tenantId, password: 'secret' });

    const uniqueCalls = user.findUnique.mock.calls as Array<
      [Record<string, unknown>]
    >;
    expect(
      uniqueCalls.every(
        (call) =>
          (call[0].where as Record<string, unknown>).email === undefined,
      ),
    ).toBe(true);
    expect(user.findMany).not.toHaveBeenCalled();
  });
});

describe('AuthService.login identifier rules', () => {
  it('rejects both identifiers together', async () => {
    const { service, user } = build([activeUser()]);

    await expect(
      service.login({ email: 'a@b.com', phone, tenantId, password: 'secret' }),
    ).rejects.toThrow(
      'Provide email, phone, employee ID, student number, guardian ID, or staff ID — only one',
    );
    expect(user.findMany).not.toHaveBeenCalled();
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects neither identifier', async () => {
    const { service } = build();

    await expect(service.login({ password: 'secret' })).rejects.toThrow(
      'Provide an email address, phone number, employee ID, student number, guardian ID, or staff ID to sign in',
    );
  });

  it('keeps the email path working unchanged', async () => {
    const { service, user } = build();
    user.findUnique.mockResolvedValue(
      activeUser({ email: 'mazin@example.com' }),
    );

    const result = await service.login({
      email: 'mazin@example.com',
      password: 'secret',
    });

    expect(user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'mazin@example.com' } }),
    );
    expect(result.user.email).toBe('mazin@example.com');
  });
});

describe('AuthService.login blocked tenants', () => {
  it.each(['SUSPENDED', 'ARCHIVED', 'PENDING'])(
    'rejects login when the only membership tenant is %s',
    async (status) => {
      const { service, jwt } = build([
        activeUser({
          memberships: [
            {
              tenantId,
              tenant: { id: tenantId, status },
              roles: [{ role: { slug: 'ADMIN' } }],
            },
          ],
        }),
      ]);

      await expect(
        service.login({ phone, tenantId, password: 'secret' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(jwt.signAsync).not.toHaveBeenCalled();
    },
  );

  it('rejects explicitly targeting a blocked tenant by id', async () => {
    const { service } = build([
      activeUser({
        memberships: [
          {
            tenantId: otherTenantId,
            tenant: { id: otherTenantId, status: 'SUSPENDED' },
            roles: [{ role: { slug: 'ADMIN' } }],
          },
        ],
      }),
    ]);

    await expect(
      service.login({ phone, tenantId: otherTenantId, password: 'secret' }),
    ).rejects.toThrow('not accepting sign-ins');
  });

  it('drops blocked tenants from the returned memberships but keeps login working', async () => {
    const { service } = build([
      activeUser({
        memberships: [
          {
            tenantId,
            tenant: { id: tenantId, status: 'ACTIVE' },
            roles: [{ role: { slug: 'ADMIN' } }],
          },
          {
            tenantId: otherTenantId,
            tenant: { id: otherTenantId, status: 'SUSPENDED' },
            roles: [{ role: { slug: 'ADMIN' } }],
          },
        ],
      }),
    ]);

    const result = await service.login({ phone, tenantId, password: 'secret' });

    expect(result.memberships).toHaveLength(1);
    expect(result.memberships[0].tenant.id).toBe(tenantId);
  });
});

describe('AuthService.login by guardian ID', () => {
  const guardianNumber = '26CPG0001';

  function buildWithGuardian(guardianResult: unknown) {
    const { service, user, jwt } = build([]);
    const guardian = { findFirst: jest.fn().mockResolvedValue(guardianResult) };
    (service as unknown as { prisma: { guardian: unknown } }).prisma = {
      user,
      guardian,
    } as never;
    user.findUnique.mockResolvedValue(activeUser());
    return { service, user, guardian, jwt };
  }

  it('normalizes the ID and signs in the linked user', async () => {
    const { service, user, guardian, jwt } = buildWithGuardian({
      userId: 'user-1',
    });

    const result = await service.login({
      guardianNumber: ' 26cpg0001 ',
      tenantId,
      password: 'secret',
    });

    expect(guardian.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, guardianNumber } }),
    );
    expect(user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect(result.accessToken).toBe('token');
    expect(result.user.id).toBe('user-1');
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1' }),
    );
  });

  it('requires a tenantId with a guardian ID', async () => {
    const { service, user } = build([]);
    const guardian = { findFirst: jest.fn() };
    (service as unknown as { prisma: unknown }).prisma = {
      user,
      guardian,
    };

    await expect(
      service.login({ guardianNumber, password: 'secret' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(guardian.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an unknown ID with the same message as a bad password', async () => {
    const { service } = buildWithGuardian(null);

    await expect(
      service.login({ guardianNumber, tenantId, password: 'secret' }),
    ).rejects.toThrow('Invalid credentials');
  });
});
