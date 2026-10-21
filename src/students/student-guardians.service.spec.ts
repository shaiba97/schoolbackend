import { StudentsService } from './students.service';
import type { PrismaService } from '../prisma/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';
const guardianId = '33333333-3333-4333-8333-333333333333';

function mockPrisma(tx: Record<string, unknown>) {
  return {
    withTenant: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    withTenantRead: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
}

function mockStorage() {
  return {} as never;
}

describe('StudentsService student guardians', () => {
  it('resets sibling primaries when creating a primary guardian', async () => {
    const tx = {
      student: { findFirst: jest.fn().mockResolvedValue({ id: studentId }) },
      guardian: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: guardianId, ...data })),
      },
      studentGuardian: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...data })),
      },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await service.createStudentGuardian(tenantId, studentId, {
      firstName: 'Amina',
      relationship: 'MOTHER',
      isPrimary: true,
    });

    expect(tx.studentGuardian.updateMany).toHaveBeenCalledWith({
      where: { studentId, tenantId, isPrimary: true },
      data: { isPrimary: false },
    });
    expect(tx.studentGuardian.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ studentId, isPrimary: true, relationship: 'MOTHER' }),
      }),
    );
  });

  it('deletes the guardian row only when its last link is removed', async () => {
    const tx = {
      studentGuardian: {
        findFirst: jest.fn().mockResolvedValue({ studentId, guardianId }),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      guardian: { delete: jest.fn().mockResolvedValue({}) },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await service.removeStudentGuardian(tenantId, studentId, guardianId);

    expect(tx.guardian.delete).toHaveBeenCalledWith({ where: { id_tenantId: { id: guardianId, tenantId } } });
  });

  it('keeps the guardian row when other links remain', async () => {
    const tx = {
      studentGuardian: {
        findFirst: jest.fn().mockResolvedValue({ studentId, guardianId }),
        delete: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
      },
      guardian: { delete: jest.fn().mockResolvedValue({}) },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await service.removeStudentGuardian(tenantId, studentId, guardianId);

    expect(tx.guardian.delete).not.toHaveBeenCalled();
  });

  it('requires a reason when postponing or firing', async () => {
    const tx = { student: { findFirst: jest.fn(), update: jest.fn() } };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await expect(service.updateStatus(tenantId, studentId, { status: 'FIRED' })).rejects.toThrow(
      'A reason is required when postponing or firing a student',
    );
    expect(tx.student.findFirst).not.toHaveBeenCalled();
  });

  it('records the status change trail in metadata', async () => {
    const tx = {
      student: {
        findFirst: jest.fn().mockResolvedValue({ id: studentId, status: 'ACTIVE', metadata: {} }),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: studentId, ...data })),
      },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    const updated = await service.updateStatus(tenantId, studentId, { status: 'POSTPONED', reason: 'Family travel' }) as Record<string, unknown>;

    expect(tx.student.update).toHaveBeenCalledWith({
      where: { id_tenantId: { id: studentId, tenantId } },
      data: expect.objectContaining({ status: 'POSTPONED' }),
    });
    const metadata = updated.metadata as Record<string, unknown>;
    expect(metadata.statusChange).toMatchObject({ from: 'ACTIVE', to: 'POSTPONED', reason: 'Family travel' });
  });

  it('lists a student guardians with sibling students without opening a transaction', async () => {
    const rows = [{ studentId, guardianId, relationship: 'FATHER', guardian: { id: guardianId } }];
    const tx = {
      student: { findFirst: jest.fn().mockResolvedValue({ id: studentId }) },
      studentGuardian: {
        findMany: jest.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([]),
      },
    };
    const prisma = mockPrisma(tx);
    const service = new StudentsService(prisma, mockStorage());

    const result = await service.listStudentGuardians(tenantId, studentId);

    expect(result).toEqual([{ ...rows[0], siblingStudents: [] }]);
    expect(prisma.withTenantRead).toHaveBeenCalled();
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });

  it('propagates the tenant into every guardian query', async () => {
    const tx = {
      student: { findFirst: jest.fn().mockResolvedValue({ id: studentId }) },
      guardian: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: guardianId, ...data })),
      },
      studentGuardian: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...data })),
      },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await service.createStudentGuardian(tenantId, studentId, { firstName: 'Amina', relationship: 'MOTHER' });

    expect(tx.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId }) }),
    );
    expect(tx.guardian.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId }) }),
    );
  });

  it('rejects an invalid status string at the service level', async () => {
    const tx = { student: { findFirst: jest.fn(), update: jest.fn() } };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await expect(service.updateStatus(tenantId, studentId, { status: 'EXPELLED_FOREVER' })).rejects.toThrow(
      'Invalid status',
    );
    expect(tx.student.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only reason', async () => {
    const tx = { student: { findFirst: jest.fn(), update: jest.fn() } };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await expect(service.updateStatus(tenantId, studentId, { status: 'POSTPONED', reason: '   ' })).rejects.toThrow(
      'A reason is required',
    );
  });

  it('accumulates history across two status changes', async () => {
    const tx = {
      student: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: studentId, status: 'ACTIVE', metadata: {} })
          .mockResolvedValueOnce({
            id: studentId,
            status: 'POSTPONED',
            metadata: {
              statusChange: { from: 'ACTIVE', to: 'POSTPONED' },
              statusHistory: [{ from: 'ACTIVE', to: 'POSTPONED' }],
            },
          }),
        update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: studentId, ...data })),
      },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await service.updateStatus(tenantId, studentId, { status: 'POSTPONED', reason: 'travel' });
    const second = (await service.updateStatus(tenantId, studentId, { status: 'ACTIVE' })) as Record<string, unknown>;
    const history = (second.metadata as Record<string, unknown>).statusHistory as unknown[];

    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ from: 'POSTPONED', to: 'ACTIVE' });
  });

  it('rejects a blank guardian first name', async () => {
    const tx = {
      student: { findFirst: jest.fn() },
      guardian: { create: jest.fn() },
      studentGuardian: { create: jest.fn(), updateMany: jest.fn() },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await expect(
      service.createStudentGuardian(tenantId, studentId, { firstName: '   ', relationship: 'FATHER' }),
    ).rejects.toThrow('Guardian first name is required');
    expect(tx.guardian.create).not.toHaveBeenCalled();
  });

  it('searches guardians tenant-scoped by name or phone', async () => {
    const tx = {
      guardian: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await service.searchGuardians(tenantId, 'Amina');

    expect(tx.guardian.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          OR: expect.arrayContaining([
            expect.objectContaining({ firstName: expect.objectContaining({ contains: 'Amina' }) }),
            expect.objectContaining({ phone: expect.objectContaining({ contains: 'Amina' }) }),
          ]),
        }),
      }),
    );
  });

  it('returns nothing for a blank search query without touching the database', async () => {
    const tx = {
      guardian: { findMany: jest.fn() },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await expect(service.searchGuardians(tenantId, '   ')).resolves.toEqual([]);
    expect(tx.guardian.findMany).not.toHaveBeenCalled();
  });

  it('returns a guardian with every linked student', async () => {
    const tx = {
      guardian: {
        findFirst: jest.fn().mockResolvedValue({
          id: guardianId,
          students: [
            { relationship: 'FATHER', student: { id: studentId } },
          ],
        }),
      },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    const result = await service.findOneGuardian(tenantId, guardianId);

    expect(tx.guardian.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: guardianId, tenantId }) }),
    );
    expect(result.students).toHaveLength(1);
  });

  it('404s a guardian from another tenant', async () => {
    const tx = {
      guardian: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    await expect(service.findOneGuardian(tenantId, guardianId)).rejects.toThrow('Guardian not found');
  });

  it('attaches sibling students to each guardian link', async () => {
    const siblingId = '44444444-4444-4444-8444-444444444444';
    const tx = {
      student: { findFirst: jest.fn().mockResolvedValue({ id: studentId }) },
      studentGuardian: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { studentId, guardianId, relationship: 'FATHER', guardian: { id: guardianId } },
          ])
          .mockResolvedValueOnce([
            { guardianId, relationship: 'FATHER', student: { id: siblingId, firstName: 'Sara', lastName: null } },
          ]),
      },
    };
    const service = new StudentsService(mockPrisma(tx), mockStorage());

    const result = (await service.listStudentGuardians(tenantId, studentId)) as unknown as Array<{
      siblingStudents: unknown[];
    }>;

    expect(result).toHaveLength(1);
    expect(result[0].siblingStudents).toEqual([
      { id: siblingId, firstName: 'Sara', lastName: null, relationship: 'FATHER' },
    ]);
  });
});
