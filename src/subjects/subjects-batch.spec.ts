import { ConflictException } from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import type { PrismaService } from '../prisma/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const deptId = '22222222-2222-4222-8222-222222222222';

function mockTx() {
  return {
    department: { findMany: jest.fn().mockResolvedValue([{ id: deptId }]) },
    subject: {
      findMany: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

function mockPrisma(tx: Record<string, any>) {
  return {
    withTenant: jest.fn(async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    withTenantRead: jest.fn(),
  } as unknown as PrismaService;
}

describe('SubjectsService.batchCreateSubjects', () => {
  it('writes the whole batch in one roundtrip and returns rows in input order', async () => {
    const tx = mockTx();
    tx.subject.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 's-2', name: 'Beta', department: { id: deptId, name: 'Science' } },
        { id: 's-1', name: 'Alpha', department: { id: deptId, name: 'Science' } },
      ]);
    const service = new SubjectsService(mockPrisma(tx) as any);

    const result: any = await service.batchCreateSubjects(tenantId, {
      items: [
        { name: 'Alpha', departmentId: deptId },
        { name: 'Beta', departmentId: deptId },
      ],
    });

    expect(tx.subject.createMany).toHaveBeenCalledTimes(1);
    expect(result.created.map((row: any) => row.name)).toEqual(['Alpha', 'Beta']);
    expect(result.created[0].department).toBeDefined();
  });

  it('rejects duplicate names within one request without touching the database writes', async () => {
    const tx = mockTx();
    const service = new SubjectsService(mockPrisma(tx) as any);

    await expect(
      service.batchCreateSubjects(tenantId, {
        items: [
          { name: 'Alpha', departmentId: deptId },
          { name: 'alpha', departmentId: deptId },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.subject.createMany).not.toHaveBeenCalled();
  });
});
