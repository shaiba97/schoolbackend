import { ConflictException, NotFoundException } from '@nestjs/common';
import { TeachersService } from './teachers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';

jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

const tenantId = '11111111-1111-4111-8111-111111111111';
const teacherId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

function cleanCounts(overrides: Record<string, number> = {}) {
  return {
    classTeacherFor: 0,
    classSubjects: 0,
    attendanceSessions: 0,
    invigilationDuties: 0,
    ...overrides,
  };
}

function build(counts: Record<string, number>, options: { documents?: string[]; credentials?: string[] } = {}) {
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    teacher: {
      findFirst: jest.fn().mockResolvedValue(
        counts === null
          ? null
          : { id: teacherId, userId, _count: cleanCounts(counts) },
      ),
      delete: jest.fn().mockResolvedValue({}),
    },
    teacherDocument: {
      findMany: jest.fn().mockResolvedValue((options.documents ?? []).map((objectKey) => ({ objectKey }))),
      deleteMany,
    },
    teacherCredential: {
      findMany: jest.fn().mockResolvedValue((options.credentials ?? []).map((objectKey) => ({ objectKey }))),
      deleteMany,
    },
  };
  const prisma = {
    withTenant: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    user: { update: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService;
  const storage = { deleteObject: jest.fn().mockResolvedValue(undefined) } as unknown as StorageService;
  return { service: new TeachersService(prisma, storage), tx, storage, prisma };
}

describe('TeachersService.delete', () => {
  it('deletes a clean teacher, their files, and deactivates the login', async () => {
    const { service, tx, storage, prisma } = build(cleanCounts(), {
      documents: ['teachers/t/d/ID_PROOF/a.jpg'],
      credentials: ['teachers/t/c/CREDENTIAL/b.pdf'],
    });

    await expect(service.delete(tenantId, teacherId)).resolves.toEqual({ deleted: true, id: teacherId });

    expect(tx.teacher.delete).toHaveBeenCalledWith({
      where: { id_tenantId: { id: teacherId, tenantId } },
    });
    expect(tx.teacherDocument.deleteMany).toHaveBeenCalledWith({ where: { tenantId, teacherId } });
    expect(tx.teacherCredential.deleteMany).toHaveBeenCalledWith({ where: { tenantId, teacherId } });
    expect(storage.deleteObject).toHaveBeenCalledWith('teachers/t/d/ID_PROOF/a.jpg');
    expect(storage.deleteObject).toHaveBeenCalledWith('teachers/t/c/CREDENTIAL/b.pdf');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { status: 'INACTIVE' },
    });
  });

  it('never deletes the user row — only disables it', async () => {
    const { service, prisma, tx } = build(cleanCounts());

    await service.delete(tenantId, teacherId);

    expect((prisma as unknown as { user: { delete: unknown } }).user.delete).toBeUndefined();
    expect(tx.teacher.delete).toHaveBeenCalled();
  });

  it.each([
    ['heads 2 class(es)', { classTeacherFor: 2 }],
    ['teaches 3 subject assignment(s)', { classSubjects: 3 }],
    ['has 5 attendance record(s)', { attendanceSessions: 5 }],
    ['holds 1 invigilation duty(ies)', { invigilationDuties: 1 }],
  ])('refuses with 409 when the teacher %s', async (fragment, counts) => {
    const { service, tx, storage, prisma } = build(counts);

    await expect(service.delete(tenantId, teacherId)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.delete(tenantId, teacherId)).rejects.toThrow(fragment);

    expect(tx.teacher.delete).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lists every blocker at once so the admin sees the full picture', async () => {
    const { service } = build({
      classTeacherFor: 1,
      classSubjects: 2,
      attendanceSessions: 7,
    });

    await expect(service.delete(tenantId, teacherId)).rejects.toThrow(
      /heads 1 class\(es\), teaches 2 subject assignment\(s\), has 7 attendance record\(s\)\. Deactivate the teacher instead\./,
    );
  });

  it('404s for a teacher in another tenant and touches nothing', async () => {
    const { service, tx, storage } = build(null as never);

    await expect(service.delete(tenantId, teacherId)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.teacher.delete).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('still deletes the teacher when a file cannot be removed from storage', async () => {
    const { service, storage } = build(cleanCounts(), { credentials: ['teachers/t/c/CREDENTIAL/gone.pdf'] });
    (storage.deleteObject as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    await expect(service.delete(tenantId, teacherId)).resolves.toEqual({ deleted: true, id: teacherId });
  });
});
