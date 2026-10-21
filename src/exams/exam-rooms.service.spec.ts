import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExamRoomsService } from './exam-rooms.service';
import type { PrismaService } from '../prisma/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const examId = '22222222-2222-4222-8222-222222222222';
const hallId = '33333333-3333-4333-8333-333333333333';
const authorId = '44444444-4444-4444-8444-444444444444';

const staff = { userId: 'staff-id', roles: ['ADMIN'] };
const author = { userId: authorId, roles: ['TEACHER'] };
const stranger = { userId: 'stranger-id', roles: ['TEACHER'] };

function mockPrisma() {
  return { withTenant: jest.fn(), withTenantRead: jest.fn() } as unknown as PrismaService;
}

function txStub(overrides: Record<string, unknown> = {}) {
  return {
    exam: { findFirst: jest.fn().mockResolvedValue({ id: examId, authorId }) },
    hall: { findFirst: jest.fn().mockResolvedValue({ id: hallId }) },
    teacher: { findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: where.id })) },
    studentEnrollment: { findMany: jest.fn().mockResolvedValue([]) },
    student: { findMany: jest.fn().mockResolvedValue([]) },
    examRoomAssignment: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'room-1', ...data })),
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.examId && where.hallId
            ? null
            : { id: 'room-1', hall: { id: hallId }, invigilators: [], students: [] },
        ),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ id: 'room-1' }),
    },
    examRoomInvigilator: { createMany: jest.fn().mockResolvedValue({ count: 0 }), deleteMany: jest.fn().mockResolvedValue({}) },
    examRoomStudent: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

function serviceWith(prisma: PrismaService, tx: Record<string, any>) {
  (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
    async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
  );
  (prisma as unknown as { withTenantRead: jest.Mock }).withTenantRead.mockImplementation(
    async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
  );
  return new ExamRoomsService(prisma);
}

describe('ExamRoomsService', () => {
  describe('assignRoom', () => {
    it('auto-fills students from the exam classes sorted by name with 1-based seat order', async () => {
      const prisma = mockPrisma();
      const tx = txStub({
        exam: {
          findFirst: jest.fn().mockResolvedValue({
            id: examId,
            authorId,
            academicYearId: 'year-1',
            examSubjects: [{ classSubject: { classId: 'class-1' } }],
          }),
        },
        studentEnrollment: {
          findMany: jest.fn().mockResolvedValue([
            { student: { id: 's-b', firstName: 'Zed', lastName: 'Zebra' } },
            { student: { id: 's-a', firstName: 'Amy', lastName: 'Apple' } },
          ]),
        },
      });
      const service = serviceWith(prisma, tx);

      await service.assignRoom(tenantId, examId, { hallId }, staff);

      expect(tx.examRoomStudent.createMany).toHaveBeenCalledWith({
        data: [
          { tenantId, examRoomAssignmentId: 'room-1', studentId: 's-a', seatOrder: 1 },
          { tenantId, examRoomAssignmentId: 'room-1', studentId: 's-b', seatOrder: 2 },
        ],
      });
    });

    it('rejects a duplicate hall for the same exam', async () => {
      const prisma = mockPrisma();
      const tx = txStub({
        exam: {
          findFirst: jest.fn().mockResolvedValue({ id: examId, authorId, academicYearId: 'y', examSubjects: [] }),
        },
        examRoomAssignment: {
          findFirst: jest.fn().mockResolvedValue({ id: 'room-1' }),
          create: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          delete: jest.fn(),
        },
      });
      const service = serviceWith(prisma, tx);

      await expect(
        service.assignRoom(tenantId, examId, { hallId, studentIds: [] }, staff),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a missing exam', async () => {
      const prisma = mockPrisma();
      const tx = txStub({ exam: { findFirst: jest.fn().mockResolvedValue(null) } });
      const service = serviceWith(prisma, tx);

      await expect(
        service.assignRoom(tenantId, examId, { hallId, studentIds: [] }, staff),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets the authoring teacher assign rooms but blocks other teachers', async () => {
      const prisma = mockPrisma();
      const tx = txStub({
        exam: {
          findFirst: jest.fn().mockResolvedValue({ id: examId, authorId, academicYearId: 'y', examSubjects: [] }),
        },
      });
      const service = serviceWith(prisma, tx);

      await expect(
        service.assignRoom(tenantId, examId, { hallId, studentIds: [] }, author),
      ).resolves.toBeDefined();
      await expect(
        service.assignRoom(tenantId, examId, { hallId, studentIds: [] }, stranger),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('reorderStudents', () => {
    it('rejects seat orders for students outside the assignment', async () => {
      const prisma = mockPrisma();
      const tx = txStub({
        examRoomAssignment: {
          findFirst: jest.fn().mockResolvedValue({ id: 'room-1', examId }),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(),
          delete: jest.fn(),
        },
        exam: { findFirst: jest.fn().mockResolvedValue({ id: examId, authorId }) },
        examRoomStudent: {
          findMany: jest.fn().mockResolvedValue([{ studentId: 's-a' }]),
          createMany: jest.fn(),
          update: jest.fn(),
          deleteMany: jest.fn(),
        },
      });
      const service = serviceWith(prisma, tx);

      await expect(
        service.reorderStudents(tenantId, examId, 'room-1', {
          orders: [{ studentId: 's-outsider', seatOrder: 1 }],
        }, staff),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.examRoomStudent.update).not.toHaveBeenCalled();
    });
  });
});
