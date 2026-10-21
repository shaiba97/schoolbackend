import * as bcrypt from 'bcrypt';
import { StudentsService } from './students.service';
import type { CreateAdmissionDto } from './dto/admission.dto';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const draftId = '22222222-2222-4222-8222-222222222222';
const academicYearId = '33333333-3333-4333-8333-333333333333';
const classId = '44444444-4444-4444-8444-444444444444';

function makeDto(): CreateAdmissionDto {
  return {
    draftId,
    student: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      motherFullname: 'Mother',
      fatherFullname: 'Father',
      roleNumber: '26CS1R01',
      password: 'student-pass',
      gender: 'MALE',
      educationLevel: 'SECONDARY',
      grade: 1,
    },
    guardian: {
      firstName: 'Guardian',
      lastName: 'User',
      phone: '+249911234567',
      password: 'guardian-pass',
      relationship: 'FATHER',
    },
    enrollment: {
      academicYearId,
      classId,
      status: 'ACTIVE',
    },
    documents: [
      {
        documentType: 'NATIONAL_CARD',
        objectKey: `staging/${tenantId}/${draftId}/NATIONAL_CARD/card.pdf`,
        originalName: 'card.pdf',
        contentType: 'application/pdf',
        size: 4,
      },
      {
        documentType: 'GUARDIAN_ID_PROOF',
        objectKey: `staging/${tenantId}/${draftId}/GUARDIAN_ID_PROOF/proof.pdf`,
        originalName: 'proof.pdf',
        contentType: 'application/pdf',
        size: 4,
      },
    ],
  };
}

describe('StudentsService.createAdmission', () => {
  it('hashes both passwords and returns no credential fields', async () => {
    const tx = {
      academicYear: { findFirst: jest.fn().mockResolvedValue({ id: academicYearId }) },
      schoolClass: { findFirst: jest.fn().mockResolvedValue({ id: classId }) },
      user: {
        create: jest
          .fn()
          .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) => ({ id: 'student-user', ...data }))
          .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) => ({ id: 'guardian-user', ...data })),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: `role-${data.slug}`, ...data })),
      },
      tenantMembership: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: `membership-${data.userId}`, ...data })),
      },
      membershipRole: { create: jest.fn().mockResolvedValue({}) },
      student: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          user: { id: data.userId, firstName: data.firstName, lastName: data.lastName, status: 'ACTIVE' },
        })),
      },
      guardian: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...data })),
      },
      studentGuardian: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          guardian: { id: data.guardianId, firstName: 'Guardian', lastName: 'User', phone: '+249911234567' },
        })),
      },
      studentEnrollment: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 'enrollment',
          ...data,
          academicYear: { id: academicYearId, name: '2026', startsOn: new Date('2026-01-01'), endsOn: new Date('2026-12-31'), isCurrent: true },
          schoolClass: { id: classId, className: 'Grade 1' },
        })),
      },
      studentDocument: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'document', ...data })),
      },
    };
    const prisma = {
      withTenant: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      withTenantRead: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const storage = {
      moveToStudent: jest.fn().mockResolvedValue({
        objectKey: `students/${tenantId}/student/GUARDIAN_ID_PROOF/proof.pdf`,
        originalName: 'proof.pdf',
        contentType: 'application/pdf',
        size: 4,
      }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as StorageService;
    const service = new StudentsService(prisma, storage);

    const result = await service.createAdmission(tenantId, makeDto());
    const userCreates = tx.user.create.mock.calls as Array<[{ data: Record<string, unknown> }]>;
    const studentHash = userCreates[0][0].data.passwordHash as string;
    const guardianHash = userCreates[1][0].data.passwordHash as string;

    expect(await bcrypt.compare('student-pass', studentHash)).toBe(true);
    expect(await bcrypt.compare('guardian-pass', guardianHash)).toBe(true);
    expect(studentHash).not.toBe('student-pass');
    expect(guardianHash).not.toBe('guardian-pass');
    expect(JSON.stringify(result)).not.toContain('student-pass');
    expect(JSON.stringify(result)).not.toContain('guardian-pass');
    expect(JSON.stringify(result)).not.toContain('passwordHash');
    expect(tx.studentDocument.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ documentType: 'GUARDIAN_ID_PROOF' }) }));
  });

  it('stamps an auto-generated guardian number on admission', async () => {
    const tx: any = {
      schoolClass: { findFirst: jest.fn().mockResolvedValue({ id: classId }) },
      user: { create: jest.fn().mockImplementation(({ data }: any) => ({ id: `user-${data.firstName}`, ...data })) },
      role: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'r', ...data })) },
      tenantMembership: { create: jest.fn().mockResolvedValue({ id: 'm' }) },
      membershipRole: { create: jest.fn().mockResolvedValue({}) },
      student: { create: jest.fn().mockImplementation(({ data }: any) => ({ ...data, user: { id: 'u' } })) },
      guardian: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: any) => ({ ...data })),
      },
      studentGuardian: { create: jest.fn().mockResolvedValue({ guardian: {} }) },
      studentEnrollment: { create: jest.fn().mockResolvedValue({ id: 'e' }) },
      studentDocument: { create: jest.fn().mockResolvedValue({ id: 'd' }) },
    };
    const prisma = {
      withTenant: jest.fn(async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx)),
      withTenantRead: jest.fn(),
    } as unknown as PrismaService;
    const storage = {
      moveToStudent: jest.fn().mockResolvedValue({ objectKey: 'k', originalName: 'o', contentType: 'c', size: 4 }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as StorageService;
    const service = new StudentsService(prisma, storage);

    await service.createAdmission(tenantId, makeDto());

    const data = tx.guardian.create.mock.calls[0][0].data;
    expect(data.guardianNumber).toMatch(/^\d{2}CPG\d{4}$/);
  });
});

describe('StudentsService.createAdmission with a linked guardian', () => {
  const linkedGuardianId = '55555555-5555-4555-8555-555555555555';

  function makeLinkTx(existingGuardian: unknown) {
    const tx: any = {
      academicYear: { findFirst: jest.fn().mockResolvedValue({ id: academicYearId }) },
      schoolClass: { findFirst: jest.fn().mockResolvedValue({ id: classId, educationLevel: 'SECONDARY', grade: 'FIRST', track: null }) },
      user: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'student-user', ...data })),
      },
      role: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: `role-${data.slug}`, ...data })),
      },
      tenantMembership: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: `membership-${data.userId}`, ...data })),
      },
      membershipRole: { create: jest.fn().mockResolvedValue({}) },
      student: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          user: { id: data.userId, firstName: data.firstName, lastName: data.lastName, status: 'ACTIVE' },
        })),
      },
      guardian: {
        findFirst: jest.fn().mockResolvedValue(existingGuardian),
        create: jest.fn(),
      },
      studentGuardian: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          guardian: { id: data.guardianId, firstName: 'Linked', lastName: 'Guardian', phone: '+249900000001' },
        })),
      },
      studentEnrollment: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 'enrollment',
          ...data,
          academicYear: { id: academicYearId, name: '2026', startsOn: new Date('2026-01-01'), endsOn: new Date('2026-12-31'), isCurrent: true },
          schoolClass: { id: classId, className: 'Grade 1' },
        })),
      },
      studentDocument: {
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'document', ...data })),
      },
    };
    const prisma = {
      withTenant: jest.fn(async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx)),
      withTenantRead: jest.fn(async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    } as unknown as PrismaService;
    const storage = {
      moveToStudent: jest.fn().mockResolvedValue({
        objectKey: `students/${tenantId}/student/NATIONAL_CARD/card.pdf`,
        originalName: 'card.pdf',
        contentType: 'application/pdf',
        size: 4,
      }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as StorageService;
    return { tx, service: new StudentsService(prisma, storage) };
  }

  function makeLinkDto() {
    const dto = makeDto();
    const linkGuardian = dto.guardian as unknown as Record<string, unknown>;
    linkGuardian.guardianId = linkedGuardianId;
    delete linkGuardian.firstName;
    delete linkGuardian.password;
    return dto;
  }

  it('links the existing guardian without creating user or guardian rows', async () => {
    const existing = {
      id: linkedGuardianId,
      guardianNumber: '26CPG0007',
      firstName: 'Linked',
      lastName: 'Guardian',
      phone: '+249900000001',
      email: null,
      address: null,
    };
    const { tx, service } = makeLinkTx(existing);

    const result = await service.createAdmission(tenantId, makeLinkDto());

    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.guardian.create).not.toHaveBeenCalled();
    expect(tx.studentGuardian.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ guardianId: linkedGuardianId, relationship: 'FATHER' }) }),
    );
    expect(result.guardian).toMatchObject({ id: linkedGuardianId, guardianNumber: '26CPG0007' });
  });

  it('rejects an unknown guardian id', async () => {
    const { service } = makeLinkTx(null);

    await expect(service.createAdmission(tenantId, makeLinkDto())).rejects.toThrow('Guardian not found');
  });

  it('links without a guardian ID proof document', async () => {
    const existing = {
      id: linkedGuardianId,
      guardianNumber: '26CPG0007',
      firstName: 'Linked',
      lastName: 'Guardian',
      phone: '+249900000001',
      email: null,
      address: null,
    };
    const { tx, service } = makeLinkTx(existing);
    const dto = makeLinkDto();
    dto.documents = dto.documents.filter((document) => document.documentType !== 'GUARDIAN_ID_PROOF');

    const result = await service.createAdmission(tenantId, dto);

    expect(tx.studentGuardian.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ guardianId: linkedGuardianId }) }),
    );
    expect(result.guardian).toMatchObject({ id: linkedGuardianId });
  });
});

describe('StudentsService field validation', () => {
  function enrollTx(classInfo: Record<string, unknown>) {
    const tx: any = {
      student: { findFirst: jest.fn().mockResolvedValue({ id: 's' }) },
      academicYear: { findFirst: jest.fn().mockResolvedValue({ id: academicYearId }) },
      schoolClass: { findFirst: jest.fn().mockResolvedValue({ id: classId, ...classInfo }) },
      studentEnrollment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'e', ...data })),
      },
    };
    const prisma = {
      withTenant: jest.fn(async (_t: string, cb: (t: unknown) => Promise<unknown>) => cb(tx)),
      withTenantRead: jest.fn(),
    } as unknown as PrismaService;
    return { tx, service: new StudentsService(prisma, {} as StorageService) };
  }

  it('rejects 3rd Secondary Science without a field', async () => {
    const { service } = enrollTx({ educationLevel: 'SECONDARY', grade: 'THIRD', track: 'SCIENCE' });

    await expect(
      service.enroll(tenantId, 's', { academicYearId, classId }),
    ).rejects.toThrow('Field of study is required');
  });

  it('rejects an Art field on a Science class', async () => {
    const { service } = enrollTx({ educationLevel: 'SECONDARY', grade: 'THIRD', track: 'SCIENCE' });

    await expect(
      service.enroll(tenantId, 's', { academicYearId, classId, field: 'MILITARY_SCIENCES' }),
    ).rejects.toThrow('Field must be one of COMPUTER, BIOLOGY, ENGINEERING');
  });

  it('accepts a matching field on 3rd Secondary Science', async () => {
    const { tx, service } = enrollTx({ educationLevel: 'SECONDARY', grade: 'THIRD', track: 'SCIENCE' });

    await service.enroll(tenantId, 's', { academicYearId, classId, field: 'COMPUTER' });

    expect(tx.studentEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ field: 'COMPUTER' }) }),
    );
  });

  it('rejects any field outside 2nd/3rd grade Secondary', async () => {
    const { service } = enrollTx({ educationLevel: 'SECONDARY', grade: 'FIRST', track: null });

    await expect(
      service.enroll(tenantId, 's', { academicYearId, classId, field: 'COMPUTER' }),
    ).rejects.toThrow('2nd/3rd grade Secondary only');
  });

  it('rejects 2nd Secondary Science without a field', async () => {
    const { service } = enrollTx({ educationLevel: 'SECONDARY', grade: 'SECOND', track: 'SCIENCE' });

    await expect(
      service.enroll(tenantId, 's', { academicYearId, classId }),
    ).rejects.toThrow('Field of study is required for 2nd grade Secondary SCIENCE');
  });

  it('accepts a matching field on 2nd Secondary Art', async () => {
    const { tx, service } = enrollTx({ educationLevel: 'SECONDARY', grade: 'SECOND', track: 'ART' });

    await service.enroll(tenantId, 's', { academicYearId, classId, field: 'MILITARY_SCIENCES' });

    expect(tx.studentEnrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ field: 'MILITARY_SCIENCES' }) }),
    );
  });
});
