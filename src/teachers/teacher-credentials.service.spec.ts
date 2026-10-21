import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TeachersService } from './teachers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const teacherId = '22222222-2222-4222-8222-222222222222';
const draftId = '33333333-3333-4333-8333-333333333333';
const stagedKey = `staging/${tenantId}/${draftId}/CREDENTIAL/abc-passport.pdf`;

function mockPrisma(tx: Record<string, unknown>) {
  return {
    withTenant: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    withTenantRead: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
}

function mockStorage() {
  return {
    moveToTeacher: jest.fn().mockResolvedValue({
      objectKey: `teachers/${tenantId}/${teacherId}/CREDENTIAL/moved-passport.pdf`,
      originalName: 'passport.pdf',
      contentType: 'application/pdf',
      size: 2048,
    }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  } as unknown as StorageService;
}

function upload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Passport',
    objectKey: stagedKey,
    originalName: 'passport.pdf',
    contentType: 'application/pdf',
    size: 2048,
    ...overrides,
  } as never;
}

describe('TeachersService credential documents', () => {
  describe('addCredential', () => {
    it('stores a named document and defaults the source to academic affairs', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'cred-1', title: 'Passport', source: 'ACADEMIC_AFFAIRS' });
      const tx = {
        teacher: { findFirst: jest.fn().mockResolvedValue({ id: teacherId }) },
        teacherCredential: { create },
      };
      const service = new TeachersService(mockPrisma(tx), mockStorage());

      await service.addCredential(tenantId, teacherId, upload());

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            teacherId,
            title: 'Passport',
            source: 'ACADEMIC_AFFAIRS',
            size: 2048,
          }),
        }),
      );
    });

    it('records a teacher-submitted document as TEACHER source', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'cred-1' });
      const tx = {
        teacher: { findFirst: jest.fn().mockResolvedValue({ id: teacherId }) },
        teacherCredential: { create },
      };
      const service = new TeachersService(mockPrisma(tx), mockStorage());

      await service.addCredential(tenantId, teacherId, upload({ source: 'TEACHER' }));

      expect(create.mock.calls[0][0].data.source).toBe('TEACHER');
    });

    it('trims the stored title', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'cred-1' });
      const tx = {
        teacher: { findFirst: jest.fn().mockResolvedValue({ id: teacherId }) },
        teacherCredential: { create },
      };
      const service = new TeachersService(mockPrisma(tx), mockStorage());

      await service.addCredential(tenantId, teacherId, upload({ title: '  Passport  ' }));

      expect(create.mock.calls[0][0].data.title).toBe('Passport');
    });

    it('rejects a non-staged object key before touching storage', async () => {
      const storage = mockStorage();
      const service = new TeachersService(mockPrisma({}), storage);

      await expect(
        service.addCredential(
          tenantId,
          teacherId,
          upload({ objectKey: `teachers/${tenantId}/${teacherId}/CREDENTIAL/somebody-elses.pdf` }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(storage.moveToTeacher).not.toHaveBeenCalled();
    });

    it("rejects another tenant's staged key", async () => {
      const storage = mockStorage();
      const service = new TeachersService(mockPrisma({}), storage);
      const foreignKey = `staging/99999999-9999-4999-8999-999999999999/${draftId}/CREDENTIAL/x.pdf`;

      await expect(
        service.addCredential(tenantId, teacherId, upload({ objectKey: foreignKey })),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(storage.moveToTeacher).not.toHaveBeenCalled();
    });

    it('rejects an unsupported content type', async () => {
      const storage = mockStorage();
      const service = new TeachersService(mockPrisma({}), storage);

      await expect(
        service.addCredential(tenantId, teacherId, upload({ contentType: 'text/html' })),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(storage.moveToTeacher).not.toHaveBeenCalled();
    });

    it('maps a duplicate title to 409', async () => {
      const tx = {
        teacher: { findFirst: jest.fn().mockResolvedValue({ id: teacherId }) },
        teacherCredential: {
          create: jest.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
        },
      };
      const service = new TeachersService(mockPrisma(tx), mockStorage());

      await expect(service.addCredential(tenantId, teacherId, upload())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('deletes the moved file when the row cannot be written', async () => {
      const tx = {
        teacher: { findFirst: jest.fn().mockResolvedValue({ id: teacherId }) },
        teacherCredential: { create: jest.fn().mockRejectedValue(new Error('db down')) },
      };
      const storage = mockStorage();
      const service = new TeachersService(mockPrisma(tx), storage);

      await expect(service.addCredential(tenantId, teacherId, upload())).rejects.toThrow('db down');

      expect(storage.deleteObject).toHaveBeenCalledWith(
        `teachers/${tenantId}/${teacherId}/CREDENTIAL/moved-passport.pdf`,
      );
    });

    it('rejects a size that changed during the move', async () => {
      const storage = mockStorage();
      const service = new TeachersService(mockPrisma({}), storage);

      await expect(
        service.addCredential(tenantId, teacherId, upload({ size: 999 })),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(storage.deleteObject).toHaveBeenCalled();
    });

    it('404s when the teacher does not exist in this tenant', async () => {
      const tx = {
        teacher: { findFirst: jest.fn().mockResolvedValue(null) },
        teacherCredential: { create: jest.fn() },
      };
      const service = new TeachersService(mockPrisma(tx), mockStorage());

      await expect(service.addCredential(tenantId, teacherId, upload())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateCredential', () => {
    it('renames a document without touching storage', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'cred-1', title: 'National ID' });
      const tx = {
        teacherCredential: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'cred-1',
            objectKey: `teachers/${tenantId}/${teacherId}/CREDENTIAL/old.pdf`,
          }),
          update,
        },
      };
      const storage = mockStorage();
      const service = new TeachersService(mockPrisma(tx), storage);

      await service.updateCredential(tenantId, teacherId, 'cred-1', { title: 'National ID' });

      expect(update).toHaveBeenCalledWith({
        where: { id_tenantId: { id: 'cred-1', tenantId } },
        data: { title: 'National ID' },
        select: expect.any(Object),
      });
      expect(storage.moveToTeacher).not.toHaveBeenCalled();
    });

    it('replaces the file and deletes the superseded one', async () => {
      const oldKey = `teachers/${tenantId}/${teacherId}/CREDENTIAL/old.pdf`;
      const newKey = `teachers/${tenantId}/${teacherId}/CREDENTIAL/moved-passport.pdf`;
      const update = jest.fn().mockResolvedValue({ id: 'cred-1' });
      const tx = {
        teacherCredential: {
          findFirst: jest.fn().mockResolvedValue({ id: 'cred-1', objectKey: oldKey }),
          update,
        },
      };
      const storage = mockStorage();
      const service = new TeachersService(mockPrisma(tx), storage);

      await service.updateCredential(tenantId, teacherId, 'cred-1', {
        objectKey: stagedKey,
        originalName: 'passport.pdf',
        contentType: 'application/pdf',
        size: 2048,
      });

      expect(update.mock.calls[0][0].data.objectKey).toBe(newKey);
      expect(storage.deleteObject).toHaveBeenCalledWith(oldKey);
    });

    it('keeps the original file when the rename collides', async () => {
      const oldKey = `teachers/${tenantId}/${teacherId}/CREDENTIAL/old.pdf`;
      const tx = {
        teacherCredential: {
          findFirst: jest.fn().mockResolvedValue({ id: 'cred-1', objectKey: oldKey }),
          update: jest.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
        },
      };
      const storage = mockStorage();
      const service = new TeachersService(mockPrisma(tx), storage);

      await expect(
        service.updateCredential(tenantId, teacherId, 'cred-1', { title: 'Passport' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(storage.deleteObject).not.toHaveBeenCalled();
    });

    it('rejects an empty update', async () => {
      const service = new TeachersService(mockPrisma({}), mockStorage());

      await expect(
        service.updateCredential(tenantId, teacherId, 'cred-1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a replacement missing its metadata', async () => {
      const service = new TeachersService(mockPrisma({}), mockStorage());

      await expect(
        service.updateCredential(tenantId, teacherId, 'cred-1', { objectKey: stagedKey }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s for a document belonging to another teacher', async () => {
      const tx = { teacherCredential: { findFirst: jest.fn().mockResolvedValue(null) } };
      const service = new TeachersService(mockPrisma(tx), mockStorage());

      await expect(
        service.updateCredential(tenantId, teacherId, 'cred-1', { title: 'X' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteCredential', () => {
    it('removes the row and its file', async () => {
      const objectKey = `teachers/${tenantId}/${teacherId}/CREDENTIAL/old.pdf`;
      const remove = jest.fn().mockResolvedValue({});
      const tx = {
        teacherCredential: {
          findFirst: jest.fn().mockResolvedValue({ id: 'cred-1', objectKey }),
          delete: remove,
        },
      };
      const storage = mockStorage();
      const service = new TeachersService(mockPrisma(tx), storage);

      await expect(service.deleteCredential(tenantId, teacherId, 'cred-1')).resolves.toEqual({
        deleted: true,
        id: 'cred-1',
      });

      expect(remove).toHaveBeenCalledWith({ where: { id_tenantId: { id: 'cred-1', tenantId } } });
      expect(storage.deleteObject).toHaveBeenCalledWith(objectKey);
    });

    it('404s without deleting anything when the row is missing', async () => {
      const tx = { teacherCredential: { findFirst: jest.fn().mockResolvedValue(null) } };
      const storage = mockStorage();
      const service = new TeachersService(mockPrisma(tx), storage);

      await expect(service.deleteCredential(tenantId, teacherId, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('listCredentials', () => {
    it('orders by title and 404s for an unknown teacher', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const tx = {
        teacher: { findFirst: jest.fn().mockResolvedValue({ id: teacherId }) },
        teacherCredential: { findMany },
      };
      const service = new TeachersService(mockPrisma(tx), mockStorage());

      await service.listCredentials(tenantId, teacherId);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, teacherId },
          orderBy: [{ title: 'asc' }, { createdAt: 'asc' }],
        }),
      );

      const missing = new TeachersService(
        mockPrisma({ teacher: { findFirst: jest.fn().mockResolvedValue(null) } }),
        mockStorage(),
      );
      await expect(missing.listCredentials(tenantId, 'ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
