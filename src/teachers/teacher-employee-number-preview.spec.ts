import { TeachersService } from './teachers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const departmentId = '22222222-2222-4222-8222-222222222222';
const year = String(new Date().getFullYear()).slice(-2);

function mockPrisma(tx: Record<string, unknown>) {
  return {
    withTenant: jest.fn(),
    withTenantRead: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
}

function mockStorage() {
  return {} as unknown as StorageService;
}

describe('TeachersService.previewEmployeeNumber', () => {
  it('derives the next number from the department letter', async () => {
    const tx = {
      department: { findFirst: jest.fn().mockResolvedValue({ name: 'Mathematics' }) },
      teacher: { findMany: jest.fn().mockResolvedValue([{ employeeNumber: `${year}CPM001` }]) },
    };
    const service = new TeachersService(mockPrisma(tx), mockStorage());

    const result = await service.previewEmployeeNumber(tenantId, departmentId);

    expect(result).toEqual({ employeeNumber: `${year}CPM002` });
    expect(tx.department.findFirst).toHaveBeenCalledWith({
      where: { id: departmentId, tenantId },
      select: { name: true },
    });
  });

  it('advances the sequence past the highest existing number', async () => {
    const tx = {
      department: { findFirst: jest.fn().mockResolvedValue({ name: 'Arabic Language' }) },
      teacher: {
        findMany: jest.fn().mockResolvedValue([
          { employeeNumber: `${year}CPA001` },
          { employeeNumber: `${year}CPA002` },
        ]),
      },
    };
    const service = new TeachersService(mockPrisma(tx), mockStorage());

    await expect(service.previewEmployeeNumber(tenantId, departmentId)).resolves.toEqual({
      employeeNumber: `${year}CPA003`,
    });
  });

  it('marks a teacher with no department as X', async () => {
    const tx = {
      department: { findFirst: jest.fn() },
      teacher: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new TeachersService(mockPrisma(tx), mockStorage());

    await expect(service.previewEmployeeNumber(tenantId)).resolves.toEqual({
      employeeNumber: `${year}CPX001`,
    });
    expect(tx.department.findFirst).not.toHaveBeenCalled();
  });

  it('reads through the tenant-scoped reader rather than a write transaction', async () => {
    const prisma = mockPrisma({
      department: { findFirst: jest.fn().mockResolvedValue(null) },
      teacher: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const service = new TeachersService(prisma, mockStorage());

    await service.previewEmployeeNumber(tenantId, departmentId);

    expect(prisma.withTenantRead).toHaveBeenCalledTimes(1);
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });
});
