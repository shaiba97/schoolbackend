import { ConflictException } from '@nestjs/common';
import { TeachersService } from './teachers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';

jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';

function build(userFindFirst: jest.Mock) {
  const create = jest.fn().mockRejectedValue(new Error('stop after the guard'));
  const tx = {
    user: { findFirst: userFindFirst, create, update: jest.fn().mockResolvedValue(undefined) },
    // Reached by employee-number generation once the phone guard passes.
    teacher: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    department: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma = {
    withTenant: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    withTenantRead: jest.fn(),
  } as unknown as PrismaService;
  const storage = {
    moveToTeacher: jest.fn(),
    deleteObject: jest.fn(),
  } as unknown as StorageService;
  return { service: new TeachersService(prisma, storage), tx, create };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Mazin',
    phone: '0912345678',
    password: 'password123',
    ...overrides,
  } as never;
}

describe('TeachersService phone rules', () => {
  it('rejects a phone already used by someone else in the same school', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'other-user' });
    const { service } = build(findFirst);

    await expect(service.create(tenantId, payload())).rejects.toBeInstanceOf(ConflictException);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        phone: '+249912345678',
        memberships: { some: { tenantId } },
      },
      select: { id: true },
    });
  });

  it('allows a number that is only taken in another school', async () => {
    // The clash query is scoped to this tenant, so a foreign hit returns null.
    const findFirst = jest.fn().mockResolvedValue(null);
    const { service, create } = build(findFirst);

    await expect(service.create(tenantId, payload())).rejects.toThrow('stop after the guard');
    expect(findFirst.mock.calls[0][0].where.memberships.some.tenantId).toBe(tenantId);
    expect(findFirst.mock.calls[0][0].where.memberships.some.tenantId).not.toBe(otherTenantId);
    expect(create).toHaveBeenCalled();
  });

  it('normalizes the stored number to E.164', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const { service, create } = build(findFirst);

    await expect(service.create(tenantId, payload({ phone: '912345678' }))).rejects.toThrow(
      'stop after the guard',
    );
    expect(findFirst.mock.calls[0][0].where.phone).toBe('+249912345678');
    expect(create).toHaveBeenCalled();
  });

  it('leaves the teacher update path untouched when no phone is supplied', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'other-user' });
    const tx = {
      teacher: {
        findFirst: jest.fn().mockResolvedValue({ id: 'teacher-1', userId: 'teacher-user' }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findFirst, update: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      withTenant: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const service = new TeachersService(prisma, {} as StorageService);

    await service.update(tenantId, 'teacher-1', { firstName: 'New' });

    // The uniqueness check only runs for a phone change.
    expect(findFirst).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ firstName: 'New' }) }),
    );
  });

  it('checks uniqueness when the phone changes, ignoring the teacher itself', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const tx = {
      teacher: {
        findFirst: jest.fn().mockResolvedValue({ id: 'teacher-1', userId: 'teacher-user' }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findFirst, update: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      withTenant: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const service = new TeachersService(prisma, {} as StorageService);

    await service.update(tenantId, 'teacher-1', { phone: '0912345678' });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        phone: '+249912345678',
        id: { not: 'teacher-user' },
        memberships: { some: { tenantId } },
      },
      select: { id: true },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'teacher-user' },
      data: { phone: '+249912345678' },
    });
  });
});
