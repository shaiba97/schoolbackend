import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ExamsService } from './exams.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const yearId = '22222222-2222-4222-8222-222222222222';
const classSubjectId = '33333333-3333-4333-8333-333333333333';

function mockPrisma() {
  return {
    withTenant: jest.fn(),
    withTenantRead: jest.fn(),
  } as unknown as PrismaService;
}

function mockStorage() {
  return {
    moveToExam: jest.fn(),
    deleteObject: jest.fn(),
  } as unknown as StorageService;
}

function mockRealtime() {
  return { emitDomainEvent: jest.fn().mockResolvedValue(undefined) } as never;
}

function subject(overrides: Record<string, unknown> = {}) {
  return { classSubjectId, maxMarks: 100, ...overrides };
}

describe('ExamsService mark and date guards', () => {
  describe('create', () => {
    it('rejects an end date before the start date without opening a transaction', async () => {
      const prisma = mockPrisma();
      const storage = mockStorage();
      const service = new ExamsService(prisma, storage, mockRealtime());

      await expect(
        service.create(tenantId, {
          academicYearId: yearId,
          name: 'Midterm',
          startsOn: '2026-03-10',
          endsOn: '2026-03-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.withTenant).not.toHaveBeenCalled();
    });

    it('rejects a subject whose passing marks exceed max marks', async () => {
      const prisma = mockPrisma();
      const service = new ExamsService(prisma, mockStorage(), mockRealtime());

      await expect(
        service.create(tenantId, {
          academicYearId: yearId,
          name: 'Midterm',
          subjects: [subject({ maxMarks: 50, passingMarks: 60 })],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.withTenant).not.toHaveBeenCalled();
    });

    it('rejects invalid subject marks before moving a staged sample', async () => {
      const prisma = mockPrisma();
      const storage = mockStorage();
      const service = new ExamsService(prisma, storage, mockRealtime());

      await expect(
        service.create(tenantId, {
          academicYearId: yearId,
          name: 'Midterm',
          subjects: [subject({ maxMarks: 10, passingMarks: 20 })],
          sample: {
            objectKey: `staging/${tenantId}/draft-1/report.pdf`,
            originalName: 'report.pdf',
            size: 1024,
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(storage.moveToExam).not.toHaveBeenCalled();
    });

    it('accepts passing marks equal to max marks', async () => {
      const prisma = mockPrisma();
      const storage = mockStorage();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            academicYear: { findFirst: jest.fn().mockResolvedValue({ id: yearId }) },
            exam: {
              create: jest.fn().mockResolvedValue({ id: 'exam-1' }),
              findFirst: jest.fn().mockResolvedValue({ id: 'exam-1', examSubjects: [] }),
            },
            examSubject: { create: jest.fn().mockResolvedValue({ id: 'es-1' }) },
            classSubject: { findFirst: jest.fn().mockResolvedValue({ id: classSubjectId }) },
          }),
      );
      const service = new ExamsService(prisma, storage, mockRealtime());

      await expect(
        service.create(tenantId, {
          academicYearId: yearId,
          name: 'Midterm',
          subjects: [subject({ maxMarks: 50, passingMarks: 50 })],
        }),
      ).resolves.toBeDefined();

      expect(storage.moveToExam).not.toHaveBeenCalled();
    });
  });

  describe('addSubject', () => {
    it('rejects passing marks above max marks without touching the database', async () => {
      const prisma = mockPrisma();
      const service = new ExamsService(prisma, mockStorage(), mockRealtime());

      await expect(
        service.addSubject(tenantId, 'exam-1', {
          classSubjectId,
          maxMarks: 20,
          passingMarks: 25,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.withTenant).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects an end date before the start date', async () => {
      const prisma = mockPrisma();
      const service = new ExamsService(prisma, mockStorage(), mockRealtime());

      await expect(
        service.update(tenantId, 'exam-1', { startsOn: '2026-05-20', endsOn: '2026-05-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.withTenant).not.toHaveBeenCalled();
    });

    it('allows a single-sided date change', async () => {
      const prisma = mockPrisma();
      const storage = mockStorage();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            exam: { findFirst: jest.fn().mockResolvedValue({ id: 'exam-1' }), update: jest.fn().mockResolvedValue({ id: 'exam-1' }) },
          }),
      );
      const service = new ExamsService(prisma, storage, mockRealtime());

      await expect(
        service.update(tenantId, 'exam-1', { endsOn: '2026-05-01' }),
      ).resolves.toBeDefined();
    });
  });

  describe('create group fan-out', () => {
    const authorId = '44444444-4444-4444-8444-444444444444';

    function groupTx() {
      const created: any[] = [];
      return {
        created,
        academicYear: { findFirst: jest.fn().mockResolvedValue({ id: yearId }) },
        schoolClass: { findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: where.id })) },
        classSubject: {
          findFirst: jest.fn().mockImplementation(({ where }: any) =>
            Promise.resolve({ id: where.id, classId: where.id === 'cs-1' ? 'class-1' : 'class-2' }),
          ),
          // Teacher-scope check on create: the author teaches every class in these tests.
          findMany: jest.fn().mockResolvedValue([{ classId: 'class-1' }, { classId: 'class-2' }]),
        },
        exam: {
          create: jest.fn().mockImplementation(({ data }: any) => {
            const row = { id: `exam-${created.length}`, ...data };
            created.push(row);
            return Promise.resolve(row);
          }),
          findFirst: jest.fn().mockResolvedValue({ id: 'exam-0', examSubjects: [] }),
        },
        examSubject: { create: jest.fn().mockResolvedValue({ id: 'es-1' }) },
      };
    }

    it('creates one exam per class sharing an examGroupId and stamps the author', async () => {
      const prisma = mockPrisma();
      const tx = groupTx();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
      );
      const service = new ExamsService(prisma, mockStorage(), mockRealtime());

      const result = await service.create(
        tenantId,
        {
          academicYearId: yearId,
          name: 'Midterm',
          classIds: ['class-1', 'class-2'],
          subjects: [
            { classSubjectId: 'cs-1', maxMarks: 100 },
            { classSubjectId: 'cs-2', maxMarks: 100 },
          ],
        } as any,
        { userId: authorId, roles: ['TEACHER'] },
      );

      expect(tx.created).toHaveLength(2);
      expect(tx.created[0].examGroupId).toBeTruthy();
      expect(tx.created[0].examGroupId).toBe(tx.created[1].examGroupId);
      expect(tx.created[0].authorId).toBe(authorId);
      expect(result).toHaveLength(2);
    });

    it('rejects subjects whose class is outside the requested classIds', async () => {
      const prisma = mockPrisma();
      const tx = groupTx();
      tx.classSubject.findFirst.mockResolvedValue({ id: 'cs-x', classId: 'class-9' });
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
      );
      const service = new ExamsService(prisma, mockStorage(), mockRealtime());

      await expect(
        service.create(
          tenantId,
          { academicYearId: yearId, name: 'Midterm', classIds: ['class-1'], subjects: [{ classSubjectId: 'cs-x', maxMarks: 10 }] } as any,
          { userId: authorId, roles: ['TEACHER'] },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.created).toHaveLength(0);
    });
  });

  describe('authorship guards', () => {
    const author = { userId: 'author-id', roles: ['TEACHER'] };
    const stranger = { userId: 'stranger-id', roles: ['TEACHER'] };

    it('blocks a teacher from editing an exam they did not author', async () => {
      const prisma = mockPrisma();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) =>
          cb({
            exam: {
              findFirst: jest.fn().mockResolvedValue({ id: 'exam-1', authorId: 'author-id' }),
              update: jest.fn(),
            },
          }),
      );
      const service = new ExamsService(prisma, mockStorage(), mockRealtime());

      await expect(
        service.update(tenantId, 'exam-1', { name: 'Renamed' }, stranger),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks a teacher from changing status even on their own exam', async () => {
      const prisma = mockPrisma();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) =>
          cb({
            exam: {
              findFirst: jest.fn().mockResolvedValue({ id: 'exam-1', authorId: 'author-id' }),
              update: jest.fn(),
            },
          }),
      );
      const service = new ExamsService(prisma, mockStorage(), mockRealtime());

      await expect(
        service.update(tenantId, 'exam-1', { status: 'PUBLISHED' }, author),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('partial lock', () => {
    it('blocks adding a subject once rooms are assigned', async () => {
      const prisma = mockPrisma();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) =>
          cb({
            exam: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'exam-1',
                _count: { examRoomAssignments: 1 },
              }),
            },
          }),
      );
      const service = new ExamsService(prisma, mockStorage(), mockRealtime());

      await expect(
        service.addSubject(tenantId, 'exam-1', { classSubjectId, maxMarks: 50 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('blocks removing a subject once rooms are assigned', async () => {
      const prisma = mockPrisma();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) =>
          cb({
            examSubject: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'es-1',
                exam: { id: 'exam-1', _count: { examRoomAssignments: 2 } },
                _count: { results: 0 },
              }),
            },
          }),
      );
      const service = new ExamsService(prisma, mockStorage(), mockRealtime());

      await expect(
        service.removeSubject(tenantId, 'exam-1', 'es-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('publishResults realtime', () => {
    it('emits exam.published to every class with subjects in the exam', async () => {
      const prisma = mockPrisma();
      const realtime = mockRealtime();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) =>
          cb({
            exam: { findFirst: jest.fn().mockResolvedValue({ id: 'exam-1' }), update: jest.fn() },
            examResult: { updateMany: jest.fn().mockResolvedValue({ count: 4 }) },
            examSubject: {
              findMany: jest.fn().mockResolvedValue([
                { classSubject: { classId: 'class-a' } },
                { classSubject: { classId: 'class-b' } },
                { classSubject: { classId: 'class-a' } },
              ]),
            },
          }),
      );
      const service = new ExamsService(prisma, mockStorage(), realtime);

      const result = await service.publishResults(tenantId, 'exam-1');

      expect(result).toEqual({ published: true });
      expect(realtime.emitDomainEvent).toHaveBeenCalledTimes(2);
      expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
        kind: 'exam.published',
        rooms: ['class:class-a'],
        payload: { examId: 'exam-1' },
      });
      expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
        kind: 'exam.published',
        rooms: ['class:class-b'],
        payload: { examId: 'exam-1' },
      });
    });

    it('emits nothing when the exam has no subjects', async () => {
      const prisma = mockPrisma();
      const realtime = mockRealtime();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) =>
          cb({
            exam: { findFirst: jest.fn().mockResolvedValue({ id: 'exam-1' }), update: jest.fn() },
            examResult: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            examSubject: { findMany: jest.fn().mockResolvedValue([]) },
          }),
      );
      const service = new ExamsService(prisma, mockStorage(), realtime);

      await service.publishResults(tenantId, 'exam-1');

      expect(realtime.emitDomainEvent).not.toHaveBeenCalled();
    });
  });

  describe('enterMarks status advance', () => {
    function mockEnterMarksTx(examStatus: string) {
      const tx = {
        examSubject: {
          findFirst: jest.fn().mockResolvedValue({
            maxMarks: { toNumber: () => 100 },
            gradingScale: null,
            exam: { id: 'exam-1', authorId: null, status: examStatus },
            classSubject: { id: classSubjectId, teacherId: null },
          }),
        },
        examResult: { upsert: jest.fn().mockResolvedValue({ id: 'result-1' }) },
        exam: { update: jest.fn().mockResolvedValue({ id: 'exam-1' }) },
      };
      return tx;
    }

    function mockEnterMarksPrisma(tx: unknown) {
      const prisma = mockPrisma();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
      );
      return {
        prisma,
        service: new ExamsService(prisma, mockStorage(), mockRealtime()),
      };
    }

    const marksDto = {
      records: [{ studentId: 'student-1', marks: 80 }],
    } as never;

    it('advances a DRAFT exam to MARKS_OPEN when marks are entered', async () => {
      const tx = mockEnterMarksTx('DRAFT');
      const { service } = mockEnterMarksPrisma(tx);

      await service.enterMarks(tenantId, 'es-1', marksDto);

      expect(tx.exam.update).toHaveBeenCalledWith({
        where: { id: 'exam-1' },
        data: { status: 'MARKS_OPEN' },
      });
    });

    it('leaves a non-DRAFT exam status untouched when marks are entered', async () => {
      const tx = mockEnterMarksTx('SCHEDULED');
      const { service } = mockEnterMarksPrisma(tx);

      await service.enterMarks(tenantId, 'es-1', marksDto);

      expect(tx.exam.update).not.toHaveBeenCalled();
    });
  });

  describe('enterMarks Test auto-publish', () => {
    function mockAutoPublishTx(examStatus: string, examTypeName: string | null) {
      const tx = {
        examSubject: {
          findFirst: jest.fn().mockResolvedValue({
            maxMarks: { toNumber: () => 100 },
            gradingScale: null,
            exam: {
              id: 'exam-1',
              authorId: null,
              status: examStatus,
              examType: examTypeName ? { name: examTypeName } : null,
            },
            classSubject: { id: classSubjectId, teacherId: null },
          }),
          findMany: jest
            .fn()
            .mockResolvedValue([{ classSubject: { classId: 'class-a' } }]),
        },
        examResult: {
          upsert: jest.fn().mockResolvedValue({ id: 'result-1' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        exam: { update: jest.fn().mockResolvedValue({ id: 'exam-1' }) },
      };
      return tx;
    }

    function mockAutoPublishService(tx: unknown) {
      const prisma = mockPrisma();
      const realtime = {
        emitDomainEvent: jest.fn().mockResolvedValue(undefined),
      };
      (
        prisma as unknown as { withTenant: jest.Mock }
      ).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
      );
      const service = new ExamsService(
        prisma,
        mockStorage(),
        realtime as never,
      );
      return { service, realtime };
    }

    const marksDto = {
      records: [{ studentId: 'student-1', marks: 80 }],
    } as never;

    it('publishes a Test exam with event when marks are submitted', async () => {
      const tx = mockAutoPublishTx('DRAFT', 'Test');
      const { service, realtime } = mockAutoPublishService(tx);

      await service.enterMarks(tenantId, 'es-1', marksDto);

      expect(tx.examResult.updateMany).toHaveBeenCalledWith({
        where: { tenantId, examSubject: { examId: 'exam-1' }, status: 'DRAFT' },
        data: { status: 'PUBLISHED' },
      });
      expect(tx.exam.update).toHaveBeenCalledWith({
        where: { id: 'exam-1' },
        data: { status: 'PUBLISHED', publishedAt: expect.any(Date) },
      });
      expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
        kind: 'exam.published',
        rooms: ['class:class-a'],
        payload: { examId: 'exam-1' },
      });
    });

    it('accepts corrections on a published Test without a second event', async () => {
      const tx = mockAutoPublishTx('PUBLISHED', 'Test');
      const { service, realtime } = mockAutoPublishService(tx);

      await service.enterMarks(tenantId, 'es-1', marksDto);

      expect(tx.examResult.upsert).toHaveBeenCalled();
      expect(tx.exam.update).not.toHaveBeenCalled();
      expect(realtime.emitDomainEvent).not.toHaveBeenCalled();
    });

    it('leaves an Exam-type exam at MARKS_OPEN with no event', async () => {
      const tx = mockAutoPublishTx('DRAFT', 'Exam');
      const { service, realtime } = mockAutoPublishService(tx);

      await service.enterMarks(tenantId, 'es-1', marksDto);

      expect(tx.exam.update).toHaveBeenCalledWith({
        where: { id: 'exam-1' },
        data: { status: 'MARKS_OPEN' },
      });
      expect(tx.examResult.updateMany).not.toHaveBeenCalled();
      expect(realtime.emitDomainEvent).not.toHaveBeenCalled();
    });

    it('leaves an untyped exam at MARKS_OPEN with no event', async () => {
      const tx = mockAutoPublishTx('DRAFT', null);
      const { service, realtime } = mockAutoPublishService(tx);

      await service.enterMarks(tenantId, 'es-1', marksDto);

      expect(tx.exam.update).toHaveBeenCalledWith({
        where: { id: 'exam-1' },
        data: { status: 'MARKS_OPEN' },
      });
      expect(realtime.emitDomainEvent).not.toHaveBeenCalled();
    });
  });

  describe('enterMarks submission lock', () => {
    function mockLockedTx() {
      const tx = {
        examSubject: {
          findFirst: jest.fn().mockResolvedValue({
            maxMarks: { toNumber: () => 100 },
            gradingScale: null,
            exam: {
              id: 'exam-1',
              authorId: 'teacher-user',
              status: 'MARKS_OPEN',
              examType: null,
            },
            classSubject: { id: classSubjectId, teacherId: null },
          }),
        },
        examResult: {
          upsert: jest.fn().mockResolvedValue({ id: 'result-1' }),
          findMany: jest.fn().mockResolvedValue([{ status: 'SUBMITTED' }]),
        },
        exam: { update: jest.fn().mockResolvedValue({ id: 'exam-1' }) },
      };
      return tx;
    }

    function mockLockedService(tx: unknown) {
      const prisma = mockPrisma();
      (prisma as unknown as { withTenant: jest.Mock }).withTenant.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
      );
      return new ExamsService(prisma, mockStorage(), mockRealtime());
    }

    const marksDto = {
      records: [{ studentId: 'student-1', marks: 80 }],
    } as never;

    it('rejects teacher edits once rows are submitted', async () => {
      const tx = mockLockedTx();
      const service = mockLockedService(tx);

      await expect(
        service.enterMarks(tenantId, 'es-1', marksDto, {
          userId: 'teacher-user',
          roles: ['TEACHER'],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.examResult.upsert).not.toHaveBeenCalled();
    });

    it('lets staff admins correct submitted rows', async () => {
      const tx = mockLockedTx();
      const service = mockLockedService(tx);

      await service.enterMarks(tenantId, 'es-1', marksDto, {
        userId: 'admin-user',
        roles: ['ADMIN'],
      });

      expect(tx.examResult.upsert).toHaveBeenCalled();
    });
  });

  describe('listModerationQueue', () => {
    function mockQueueTx() {
      const tx = {
        exam: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'exam-1',
              name: 'Midterm',
              status: 'MODERATION',
              publishedAt: null,
              academicYearId: 'year-1',
              examType: { name: 'Exam' },
              examSubjects: [
                {
                  id: 'es-1',
                  results: [{ studentId: 's-1', status: 'SUBMITTED' }],
                  classSubject: {
                    classId: 'class-1',
                    subject: { name: 'Math' },
                    schoolClass: { id: 'class-1', className: 'Grade 6' },
                  },
                },
              ],
            },
          ]),
        },
        studentEnrollment: {
          findMany: jest.fn().mockResolvedValue([{ studentId: 's-1' }]),
        },
      };
      return tx;
    }

    function mockQueueService(tx: unknown) {
      const prisma = mockPrisma();
      (prisma as unknown as { withTenantRead: jest.Mock }).withTenantRead.mockImplementation(
        async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx),
      );
      return new ExamsService(prisma, mockStorage(), mockRealtime());
    }

    it('lists MODERATION exams with per-class submitted counts', async () => {
      const tx = mockQueueTx();
      const service = mockQueueService(tx);

      const queue = await service.listModerationQueue(tenantId);

      expect(tx.exam.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'MODERATION' },
        }),
      );
      expect(queue.exams).toHaveLength(1);
      expect(queue.exams[0]).toMatchObject({ examId: 'exam-1', examName: 'Midterm' });
      expect(queue.exams[0].classes[0]).toMatchObject({ classId: 'class-1' });
      expect(queue.exams[0].classes[0].subjects[0]).toMatchObject({
        subjectName: 'Math',
        submitted: 1,
        total: 1,
        allSubmitted: true,
      });
    });

    it('returns an empty queue when nothing awaits publishing', async () => {
      const tx = mockQueueTx();
      tx.exam.findMany.mockResolvedValue([]);
      const service = mockQueueService(tx);

      const queue = await service.listModerationQueue(tenantId);

      expect(queue).toEqual({ exams: [] });
    });
  });
});
