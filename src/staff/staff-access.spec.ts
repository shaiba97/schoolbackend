import { NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';

const TENANT = 'tenant-1';

/** JwtService double: mintSocketTicket only signs; verification never happens here. */
function stubJwt() {
  return { signAsync: jest.fn(async () => 'test-ticket'), verifyAsync: jest.fn() } as any;
}

function txBase(over: any = {}) {
  return {
    user: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data, select }: any) => {
        const row = { id: 'u-1', ...data };
        if (select) Object.keys(row).forEach((k) => { if (!(k in select)) delete (row as any)[k]; });
        return row;
      }),
      update: jest.fn(async ({ data }: any) => ({ id: 'u-1', ...data })),
    },
    tenantMembership: {
      create: jest.fn(async ({ data }: any) => ({ id: 'm-1', ...data })),
      findFirst: jest.fn(async () => ({ id: 'm-1' })),
    },
    role: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.slug?.startsWith?.('CUSTOM_') ? null : { id: `r-${where.slug}`, slug: where.slug, name: where.slug },
      ),
      create: jest.fn(async ({ data }: any) => ({ id: `r-${data.slug}`, ...data })),
    },
    membershipRole: {
      create: jest.fn(async ({ data }: any) => data),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    ...over,
  } as any;
}

function prismaWith(tx: any) {
  return {
    $transaction: async (cb: any) => cb(tx),
    withTenantRead: async (_tenantId: string, cb: any) => cb(tx),
    user: tx.user,
  } as any;
}

const svc = (tx: any) => new StaffService(prismaWith(tx), stubJwt());

describe('create: system positions', () => {
  it('creates an ACCOUNTANT login for FINANCIAL_AFFAIRS with staff ID + hashed password (no email)', async () => {
    const tx = txBase();
    const out: any = await svc(tx).create(TENANT, {
      fullName: 'Hassan Shaiba', phone: '+249100000001',
      position: 'FINANCIAL_AFFAIRS', password: 'secret123',
    } as any);

    const created = tx.user.create.mock.calls[0][0].data;
    expect(created.passwordHash).toBeTruthy();
    expect(created.passwordHash).not.toBe('secret123');
    expect(created).not.toHaveProperty('email');
    expect(created.staffNumber).toMatch(/^26ACC/);
    expect(tx.role.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ slug: 'ACCOUNTANT' }) }));
    expect(out.hasSystemAccess).toBe(true);
    expect(out.position).toBe('FINANCIAL_AFFAIRS');
  });

  it('400s a system position without a password', async () => {
    await expect(
      svc(txBase()).create(TENANT, {
        fullName: 'Amina Khalid', phone: '+249100000002',
        position: 'ACADEMIC_AFFAIRS',
      } as any),
    ).rejects.toThrow('Password is required');
  });

  it('creates a TRANSPORT_COORDINATOR login with TRC-prefix staff ID and TRANSPORT_COORDINATOR role', async () => {
    const tx = txBase();
    const out: any = await svc(tx).create(TENANT, {
      fullName: 'Bilal Osman', phone: '+249100000005',
      position: 'TRANSPORT_COORDINATOR', password: 'secret123',
    } as any);

    const created = tx.user.create.mock.calls[0][0].data;
    expect(created.staffNumber).toMatch(/^26TRC/);
    expect(created.passwordHash).toBeTruthy();
    expect(tx.role.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ slug: 'TRANSPORT_COORDINATOR' }) }));
    expect(out.hasSystemAccess).toBe(true);
    expect(out.position).toBe('TRANSPORT_COORDINATOR');
    expect(out.positionTitle).toBe('Transport Coordinator');
  });
});

describe('create: operational positions', () => {
  it('creates a JANITOR record with no login (null passwordHash, own role row)', async () => {
    const tx = txBase();
    const out: any = await svc(tx).create(TENANT, {
      fullName: 'Omar Haddad', phone: '+249100000003', position: 'JANITOR',
    } as any);

    const created = tx.user.create.mock.calls[0][0].data;
    expect(created.passwordHash).toBeNull();
    expect(created.staffNumber).toMatch(/^26JAN/);
    expect(out.hasSystemAccess).toBe(false);
    expect(out.position).toBe('JANITOR');
  });

  it('400s an operational position carrying a password', async () => {
    await expect(
      svc(txBase()).create(TENANT, {
        fullName: 'Omar Haddad', phone: '+249100000003', position: 'LIBRARIAN', password: 'secret123',
      } as any),
    ).rejects.toThrow('must not set a password');
  });

  it('400s CUSTOM without a custom title, and mints a per-staff CUSTOM_ role with the title', async () => {
    await expect(
      svc(txBase()).create(TENANT, { fullName: 'Lina Nasser', phone: '+249100000004', position: 'CUSTOM' } as any),
    ).rejects.toThrow('Custom position title is required');

    const tx = txBase();
    const out: any = await svc(tx).create(TENANT, {
      fullName: 'Lina Nasser', phone: '+249100000004', position: 'CUSTOM', customPositionTitle: 'Security Guard',
    } as any);

    const roleCreated = tx.role.create.mock.calls[0][0].data;
    expect(roleCreated.slug).toMatch(/^CUSTOM_/);
    expect(roleCreated.name).toBe('Security Guard');
    expect(out.hasSystemAccess).toBe(false);
    expect(out.position).toBe('CUSTOM');
    expect(out.positionTitle).toBe('Security Guard');
  });
});

describe('previewStaffNumber', () => {
  it('returns the next position-prefixed staff number without creating', async () => {
    const prisma: any = {
      user: { findMany: jest.fn(async () => [{ staffNumber: '26REC0007' }]) },
    };
    const out: any = await new StaffService(prisma, stubJwt()).previewStaffNumber('RECEPTIONIST');
    expect(out).toMatchObject({ staffNumber: '26REC0008' });
  });

  it('previews a TRC-prefixed number for TRANSPORT_COORDINATOR', async () => {
    const prisma: any = {
      user: { findMany: jest.fn(async () => [{ staffNumber: '26TRC0001' }]) },
    };
    const out: any = await new StaffService(prisma, stubJwt()).previewStaffNumber('TRANSPORT_COORDINATOR');
    expect(out).toMatchObject({ staffNumber: '26TRC0002' });
  });

  it('400s an unknown position key', async () => {
    const prisma: any = { user: { findMany: jest.fn(async () => []) } };
    await expect(new StaffService(prisma, stubJwt()).previewStaffNumber('NOPE')).rejects.toThrow();
  });
});

describe('list filter', () => {
  it('covers operational + custom role slugs, not just the 3 system ones', async () => {
    const tx = txBase();
    const prisma: any = { ...prismaWith(tx), user: { ...tx.user, findMany: jest.fn(async () => []) } };
    await new StaffService(prisma, stubJwt()).list(TENANT, {} as any);

    const where = (prisma.user.findMany as jest.Mock).mock.calls[0][0].where;
    const slugFilter = where.memberships.some.roles.some.role;
    expect(JSON.stringify(slugFilter)).toContain('PRINCIPAL');
    expect(JSON.stringify(slugFilter)).toContain('CUSTOM_');
  });
});

describe('resetPassword', () => {
  it('400s a reset for staff without portal access', async () => {
    const prisma: any = {
      user: {
        findFirst: jest.fn(async () => ({
          id: 'u-9', memberships: [{ status: 'ACTIVE', roles: [{ role: { slug: 'JANITOR' } }] }],
        })),
      },
    };
    await expect(
      new StaffService(prisma, stubJwt()).resetPassword(TENANT, 'u-9', { password: 'newsecret1' } as any, 'admin-1'),
    ).rejects.toThrow('no portal access');
  });

  it('hashes and stores the new password for system staff', async () => {
    const prisma: any = {
      user: {
        findFirst: jest.fn(async () => ({
          id: 'u-1', memberships: [{ status: 'ACTIVE', roles: [{ role: { slug: 'ACCOUNTANT' } }] }],
        })),
        update: jest.fn(async ({ data }: any) => ({ id: 'u-1' })),
      },
    };
    await new StaffService(prisma, stubJwt()).resetPassword(TENANT, 'u-1', { password: 'newsecret1' } as any, 'admin-1');
    const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(data.passwordHash).toBeTruthy();
    expect(data.passwordHash).not.toBe('newsecret1');
  });
});

describe('update role replacement', () => {
  it('replaces membership roles instead of appending (single-position invariant)', async () => {
    const tx = txBase({
      user: {
        findFirst: jest.fn(async () => ({ id: 'u-1' })),
        update: jest.fn(async () => ({ id: 'u-1' })),
      },
    });
    await svc(tx).update(TENANT, 'u-1', { position: 'PRINCIPAL' } as any, 'admin-1');
    expect(tx.membershipRole.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ membershipId: 'm-1' }) }),
    );
    expect(tx.membershipRole.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ membershipId: 'm-1' }) }),
    );
  });
});

describe('socket ticket', () => {
  it('mints a short-lived, socket-scoped ticket for the authenticated staff member', async () => {
    const jwt = stubJwt();
    const svc = new StaffService({} as any, jwt);

    const result = await svc.mintSocketTicket(TENANT, 'staff-user-1');

    expect(result).toEqual({ ticket: 'test-ticket', expiresIn: 600 });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { sub: 'staff-user-1', tenantId: TENANT },
      expect.objectContaining({ audience: 'socket' }),
    );
  });
});

describe('getProfile', () => {
  const activeMembership = {
    tenantId: TENANT,
    status: 'ACTIVE',
    tenant: { id: TENANT, name: 'Sana School' },
    roles: [{ role: { slug: 'TRANSPORT_COORDINATOR', name: 'Transport Coordinator' } }],
  };

  function coordinatorRow(over: any = {}) {
    return {
      id: 'u-coord',
      firstName: 'Nabeil',
      lastName: 'Ahmed',
      staffNumber: '26TRC0001',
      phone: '+249966376660',
      email: null,
      avatarUrl: null,
      status: 'ACTIVE',
      passwordHash: 'hashed-bearer',
      memberships: [activeMembership],
      ...over,
    };
  }

  it('returns the authenticated staff profile with position metadata and tenant, without credentials', async () => {
    const tx = txBase({ user: { findFirst: jest.fn(async () => coordinatorRow()) } as any });
    const out: any = await svc(tx).getProfile(TENANT, 'u-coord');

    expect(out).toMatchObject({
      id: 'u-coord',
      firstName: 'Nabeil',
      lastName: 'Ahmed',
      fullName: 'Nabeil Ahmed',
      staffNumber: '26TRC0001',
      phone: '+249966376660',
      status: 'ACTIVE',
      position: 'TRANSPORT_COORDINATOR',
      positionTitle: 'Transport Coordinator',
      roles: ['TRANSPORT_COORDINATOR'],
      tenant: { id: TENANT, name: 'Sana School' },
    });
    expect(JSON.stringify(out)).not.toContain('passwordHash');
    expect(JSON.stringify(out)).not.toContain('hashed-bearer');
  });

  it('scopes the lookup to this tenant and only ACTIVE memberships', async () => {
    const tx = txBase({ user: { findFirst: jest.fn(async () => coordinatorRow()) } as any });
    await svc(tx).getProfile(TENANT, 'u-coord');

    const args = (tx.user.findFirst as jest.Mock).mock.calls[0][0];
    expect(args.where).toMatchObject({ id: 'u-coord', status: { not: 'DELETED' } });
    expect(args.select.memberships.where).toEqual({ tenantId: TENANT, status: 'ACTIVE' });
  });

  it('404s when the user is missing or holds no ACTIVE membership in this tenant', async () => {
    const emptyTx = txBase({ user: { findFirst: jest.fn(async () => null) } as any });
    await expect(svc(emptyTx).getProfile(TENANT, 'u-gone')).rejects.toThrow(NotFoundException);

    const noMembershipTx = txBase({
      user: { findFirst: jest.fn(async () => coordinatorRow({ memberships: [] })) } as any,
    });
    await expect(svc(noMembershipTx).getProfile(TENANT, 'u-coord')).rejects.toThrow(NotFoundException);
  });
});
