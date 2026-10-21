import { TeachersService } from './teachers.service';
import type { PrismaService } from '../prisma/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('TeachersService.create transaction timeout', () => {
  it('opens the create transaction with an extended timeout (P2028 guard)', async () => {
    const tx = {
      classSubject: { findFirst: jest.fn().mockResolvedValue(null) },
      department: { findFirst: jest.fn().mockResolvedValue({ id: 'dept-1' }) },
      teacher: {
        findFirst: jest.fn().mockImplementation(({ where }: any) =>
          where?.employeeNumber ? Promise.resolve(null) : Promise.resolve({ id: 't-1' }),
        ),
        findUnique: jest.fn().mockResolvedValue({ id: 't-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 't-1' }),
      },
      user: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'u-1' }) },
      tenantMembership: { create: jest.fn().mockResolvedValue({ id: 'm-1' }) },
      role: { findFirst: jest.fn().mockResolvedValue({ id: 'r-1' }) },
      membershipRole: { create: jest.fn().mockResolvedValue({ id: 'mr-1' }) },
      teacherDocument: { deleteMany: jest.fn().mockResolvedValue({}) },
    };
    const withTenant = jest.fn(async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx));
    const prisma = { withTenant, withTenantRead: jest.fn() } as unknown as PrismaService;
    const service = new TeachersService(prisma, { moveToTeacher: jest.fn(), deleteObject: jest.fn() } as any);

    await service.create(tenantId, {
      firstName: 'Test',
      phone: '+24990000001',
      password: 'Comboni@123',
      gender: 'MALE' as any,
    } as any);

    expect(withTenant).toHaveBeenCalledWith(
      tenantId,
      expect.any(Function),
      expect.objectContaining({ timeout: 30000 }),
    );
  });
});
