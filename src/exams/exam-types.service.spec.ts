import { ExamTypesService } from './exam-types.service';
import type { PrismaService } from '../prisma/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function mockPrisma(tx: Record<string, unknown>) {
  return {
    withTenant: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    withTenantRead: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
}

describe('ExamTypesService', () => {
  it('creates a type with a trimmed name', async () => {
    const tx = {
      examType: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'type-1', ...data })),
      },
    };
    const service = new ExamTypesService(mockPrisma(tx));

    await service.create(tenantId, { name: '  Midterm  ' });

    expect(tx.examType.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Midterm', tenantId }),
    });
  });

  it('rejects a duplicate type name with 409', async () => {
    const tx = {
      examType: {
        findFirst: jest.fn().mockResolvedValue({ id: 'type-1' }),
        create: jest.fn(),
      },
    };
    const service = new ExamTypesService(mockPrisma(tx));

    await expect(service.create(tenantId, { name: 'Midterm' })).rejects.toThrow(
      'An exam type with this name already exists',
    );
    expect(tx.examType.create).not.toHaveBeenCalled();
  });

  it('refuses to delete a type used by exams', async () => {
    const tx = {
      examType: {
        findFirst: jest.fn().mockResolvedValue({ id: 'type-1', _count: { exams: 2 } }),
        delete: jest.fn(),
      },
    };
    const service = new ExamTypesService(mockPrisma(tx));

    await expect(service.remove(tenantId, 'type-1')).rejects.toThrow(
      'Cannot delete exam type used by 2 exam(s)',
    );
    expect(tx.examType.delete).not.toHaveBeenCalled();
  });

  it('lists types without opening a transaction', async () => {
    const rows = [{ id: 'type-1', name: 'Midterm' }];
    const tx = { examType: { findMany: jest.fn().mockResolvedValue(rows) } };
    const prisma = mockPrisma(tx);
    const service = new ExamTypesService(prisma);

    await expect(service.list(tenantId)).resolves.toBe(rows);
    expect(prisma.withTenantRead).toHaveBeenCalled();
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });
});
