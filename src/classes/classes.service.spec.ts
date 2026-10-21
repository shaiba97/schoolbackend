import { ClassesService } from './classes.service';
import type { PrismaService } from '../prisma/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

describe('ClassesService', () => {
  it('maps the class form fields to the Prisma model', async () => {
    const tx = {
      schoolClass: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'class-1', ...data })),
      },
    };
    const prisma = {
      withTenant: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      withTenantRead: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ClassesService(prisma);

    await service.createClass(tenantId, {
      className: 'Grade 10',
      educationLevel: 'SECONDARY',
      grade: 'FIRST',
      gender: 'BOYS',
    });

    expect(tx.schoolClass.create).toHaveBeenCalledWith({
      data: {
        tenantId,
        className: 'Grade 10',
        educationLevel: 'SECONDARY',
        grade: 'FIRST',
        track: undefined,
        gender: 'BOYS',
        capacity: undefined,
      },
    });
  });

  it('rejects a track on a first secondary grade', async () => {
    const prisma = {} as PrismaService;
    const service = new ClassesService(prisma);

    await expect(service.createClass(tenantId, {
      className: 'Grade 10',
      educationLevel: 'SECONDARY',
      grade: 'FIRST',
      track: 'SCIENCE',
      gender: 'MIXED',
    })).rejects.toThrow('Track is only valid for SECOND or THIRD grade');
  });

  it('rejects girls for an intermediate class', async () => {
    const prisma = {} as PrismaService;
    const service = new ClassesService(prisma);

    await expect(service.createClass(tenantId, {
      className: '6th Girls',
      educationLevel: 'INTERMEDIATE',
      grade: 'SIXTH',
      gender: 'GIRLS',
    })).rejects.toThrow('Girls classes are not allowed for Intermediate level');
  });

  it('rejects a mixed class at any level', async () => {
    const prisma = {} as PrismaService;
    const service = new ClassesService(prisma);

    await expect(service.createClass(tenantId, {
      className: '1st Mixed',
      educationLevel: 'SECONDARY',
      grade: 'FIRST',
      gender: 'MIXED',
    })).rejects.toThrow('Secondary classes must be BOYS or GIRLS');
  });

  it('accepts boys and girls secondary classes without a track in first grade', async () => {
    const tx = {
      schoolClass: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'class-1', ...data })),
      },
    };
    const prisma = {
      withTenant: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      withTenantRead: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const service = new ClassesService(prisma);

    await expect(service.createClass(tenantId, {
      className: '1st Girls B',
      educationLevel: 'SECONDARY',
      grade: 'FIRST',
      gender: 'GIRLS',
      capacity: 15,
    })).resolves.toBeDefined();
  });
});
