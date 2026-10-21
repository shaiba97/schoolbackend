import { HallsService } from './halls.service';
import type { PrismaService } from '../prisma/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function mockPrisma(tx: Record<string, unknown>) {
  return {
    withTenant: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    withTenantRead: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
}

describe('HallsService', () => {
  it('creates a hall with a trimmed name', async () => {
    const tx = {
      hall: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'hall-1', ...data })),
      },
    };
    const service = new HallsService(mockPrisma(tx));

    await service.create(tenantId, { name: '  Hall A  ', capacity: 40 });

    expect(tx.hall.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Hall A', capacity: 40, tenantId }),
    });
  });

  it('rejects a duplicate hall name with 409', async () => {
    const tx = {
      hall: {
        findFirst: jest.fn().mockResolvedValue({ id: 'hall-1' }),
        create: jest.fn(),
      },
    };
    const service = new HallsService(mockPrisma(tx));

    await expect(service.create(tenantId, { name: 'Hall A', capacity: 40 })).rejects.toThrow(
      'A hall with this name already exists',
    );
    expect(tx.hall.create).not.toHaveBeenCalled();
  });

  it('refuses to delete a hall referenced by scheduled sessions', async () => {
    const tx = {
      hall: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'hall-1',
          _count: { timetableSlots: 1, seatAssignments: 0, invigilationDuties: 0 },
        }),
        delete: jest.fn(),
      },
    };
    const service = new HallsService(mockPrisma(tx));

    await expect(service.remove(tenantId, 'hall-1')).rejects.toThrow(
      'Cannot delete a hall referenced by scheduled sessions',
    );
    expect(tx.hall.delete).not.toHaveBeenCalled();
  });

  it('lists halls without opening a transaction', async () => {
    const rows = [{ id: 'hall-1', name: 'Hall A' }];
    const tx = { hall: { findMany: jest.fn().mockResolvedValue(rows) } };
    const prisma = mockPrisma(tx);
    const service = new HallsService(prisma);

    await expect(service.list(tenantId)).resolves.toBe(rows);
    expect(prisma.withTenantRead).toHaveBeenCalled();
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });
});
