import { TeachersService } from './teachers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function build(findMany: jest.Mock) {
  const tx = {
    teacher: { findMany, count: jest.fn().mockResolvedValue(0) },
  };
  const prisma = {
    withTenantRead: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
  return new TeachersService(prisma, {} as StorageService);
}

describe('TeachersService.findAll ordering', () => {
  /**
   * Regression guard: the list once ordered by `Teacher.id`, which is a UUID
   * and therefore random, then a fix introduced `Teacher.createdAt` — a column
   * the model does not have. Neither mistake is visible to tsc (the tenant
   * callback is `any`) or to mocked unit tests; both only fail against a real
   * database with `Unknown argument`. So assert the exact shape here, and
   * keep it in step with the schema.
   */
  it('orders oldest-first by the related user, never by a teacher timestamp', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await build(findMany).findAll(tenantId, { page: 1, limit: 50 });

    const args = findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ user: { createdAt: 'asc' } }, { id: 'asc' }]);
    // `Teacher` has no createdAt column: no sort key may sit at the top level.
    for (const key of args.orderBy) {
      expect(key).not.toHaveProperty('createdAt');
    }
  });

  it('falls back to id only as a tiebreak, not as the primary sort', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await build(findMany).findAll(tenantId, { page: 1, limit: 50 });

    const [primary] = findMany.mock.calls[0][0].orderBy;
    expect(primary).not.toEqual({ id: 'asc' });
  });

  it('selects every document field the update payload requires', async () => {
    // Regression guard: the list once selected only documentType + objectKey,
    // so the edit form echoed rows with undefined originalName/contentType/size
    // and every teacher update failed DTO validation. The list shape must stay
    // in step with UploadedTeacherDocumentDto.
    const findMany = jest.fn().mockResolvedValue([]);
    await build(findMany).findAll(tenantId, { page: 1, limit: 50 });

    const args = findMany.mock.calls[0][0];
    expect(args.include.documents).toEqual({
      select: {
        id: true,
        documentType: true,
        objectKey: true,
        originalName: true,
        contentType: true,
        size: true,
        createdAt: true,
      },
    });
  });
});
