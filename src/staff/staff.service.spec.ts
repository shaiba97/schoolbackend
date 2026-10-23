import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { StaffService } from './staff.service';

const TENANT = 'tenant-1';

function stubJwt() {
  return { signAsync: jest.fn(async () => 'test-ticket'), verifyAsync: jest.fn() } as any;
}

function prismaUser(over: any = {}) {
  return {
    id: 'u-coord',
    firstName: 'Nabeil',
    lastName: 'Ahmed',
    phone: '+249966376660',
    passwordHash: '$2b$10$hashed.current',
    status: 'ACTIVE',
    ...over,
  };
}

const activeMembership = {
  tenantId: TENANT,
  status: 'ACTIVE',
  tenant: { id: TENANT, name: 'Sana School' },
  roles: [{ role: { slug: 'TRANSPORT_COORDINATOR', name: 'Transport Coordinator' } }],
};

function coordinatorRow(over: any = {}) {
  return { ...prismaUser(), memberships: [activeMembership], ...over };
}

function prismaWith(over: any = {}) {
  let current = coordinatorRow(over);
  const prisma: any = {
    user: {
      ...current,
      findFirst: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (where.phone) return null;
        return { ...current, memberships: [activeMembership] };
      }),
      update: jest.fn(async ({ data }: any) => {
        current = { ...current, ...data };
        return current;
      }),
      findMany: jest.fn(async () => []),
    },
    withTenantRead: async (_tenantId: string, cb: any) => cb(prisma),
  };
  return prisma;
}

const svc = (prisma: any) => new StaffService(prisma, stubJwt());

describe('updateMyProfile', () => {
  it('updates fullName and phone, splits the name, and returns the profile without credentials', async () => {
    let stored = coordinatorRow();
    const prisma = prismaWith();
    prisma.user.findFirst = jest.fn(async (args: any) => {
      const where = args?.where ?? {};
      if (where.phone) return null;
      return { ...stored, memberships: [activeMembership] };
    });
    prisma.user.update = jest.fn(async ({ data }: any) => {
      stored = { ...stored, ...data };
      return stored;
    });

    const out: any = await svc(prisma).updateMyProfile(TENANT, 'u-coord', {
      fullName: 'Nabeil Ahmed Ali',
      phone: '+249966376661',
    } as any);

    expect(out).toMatchObject({
      id: 'u-coord',
      firstName: 'Nabeil',
      lastName: 'Ahmed Ali',
      fullName: 'Nabeil Ahmed Ali',
      phone: '+249966376661',
      status: 'ACTIVE',
      tenant: { id: TENANT, name: 'Sana School' },
    });
    expect(JSON.stringify(out)).not.toContain('passwordHash');
    const call = (prisma.user.update as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ id: 'u-coord' });
    expect(call.data).toMatchObject({ firstName: 'Nabeil', lastName: 'Ahmed Ali', phone: '+249966376661' });
  });

  it('updates only fullName when phone is omitted', async () => {
    const prisma = prismaWith();
    await svc(prisma).updateMyProfile(TENANT, 'u-coord', { fullName: 'Nabeil Omar' } as any);
    const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ firstName: 'Nabeil', lastName: 'Omar' });
    expect(data.phone).toBeUndefined();
  });

  it('409s when the phone is taken by another user', async () => {
    const prisma = prismaWith();
    prisma.user.findFirst = jest.fn(async (args: any) => {
      const where = args?.where ?? {};
      if (where.phone) return where.phone === '+249966376660' ? { id: 'u-other', phone: '+249966376660' } : null;
      return { ...coordinatorRow(), memberships: [activeMembership] };
    });

    await expect(
      svc(prisma).updateMyProfile(TENANT, 'u-coord', { phone: '+249966376660' } as any),
    ).rejects.toThrow(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('keeps the staff member\'s own phone without conflict', async () => {
    const prisma = prismaWith();
    await svc(prisma).updateMyProfile(TENANT, 'u-coord', { phone: '+249966376660' } as any);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('404s when the user is missing or holds no ACTIVE membership in this tenant', async () => {
    const emptyPrisma = prismaWith();
    emptyPrisma.user.findFirst = jest.fn(async () => null);
    await expect(svc(emptyPrisma).updateMyProfile(TENANT, 'u-gone', {} as any)).rejects.toThrow(NotFoundException);

    const noMemberPrisma = prismaWith({ memberships: [] });
    noMemberPrisma.user.findFirst = jest.fn(async () => ({ ...coordinatorRow({ memberships: [] }) }));
    await expect(svc(noMemberPrisma).updateMyProfile(TENANT, 'u-coord', {} as any)).rejects.toThrow(NotFoundException);
  });
});

describe('changeMyPassword', () => {
  it('hashes and stores the new password, then reports changed', async () => {
    const prisma = prismaWith({ passwordHash: await bcrypt.hash('current-secret', 10) });
    const result = await svc(prisma).changeMyPassword(TENANT, 'u-coord', {
      currentPassword: 'current-secret',
      newPassword: 'newsecret1',
    } as any);

    expect(result).toEqual({ changed: true });
    const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(data.passwordHash).toBeTruthy();
    expect(data.passwordHash).not.toBe('newsecret1');
    expect(await bcrypt.compare('newsecret1', data.passwordHash)).toBe(true);
  });

  it('403s when the current password is wrong', async () => {
    const prisma = prismaWith({ passwordHash: await bcrypt.hash('current-secret', 10) });
    await expect(
      svc(prisma).changeMyPassword(TENANT, 'u-coord', { currentPassword: 'wrong', newPassword: 'newsecret1' } as any),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('400s when the new password equals the current one', async () => {
    const hash = await bcrypt.hash('same-secret', 10);
    const prisma = prismaWith({ passwordHash: hash });
    await expect(
      svc(prisma).changeMyPassword(TENANT, 'u-coord', { currentPassword: 'same-secret', newPassword: 'same-secret' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('400s when the account has no password set', async () => {
    const prisma = prismaWith({ passwordHash: null });
    await expect(
      svc(prisma).changeMyPassword(TENANT, 'u-coord', { currentPassword: 'x', newPassword: 'newsecret1' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s when the user is missing or holds no ACTIVE membership in this tenant', async () => {
    const emptyPrisma = prismaWith();
    emptyPrisma.user.findFirst = jest.fn(async () => null);
    await expect(svc(emptyPrisma).changeMyPassword(TENANT, 'u-gone', {} as any)).rejects.toThrow(NotFoundException);

    const noMemberPrisma = prismaWith({ memberships: [] });
    noMemberPrisma.user.findFirst = jest.fn(async () => ({ ...coordinatorRow({ memberships: [] }) }));
    await expect(svc(noMemberPrisma).changeMyPassword(TENANT, 'u-coord', {} as any)).rejects.toThrow(NotFoundException);
  });
});
