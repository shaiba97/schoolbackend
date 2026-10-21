import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto, UpdateStudentDto } from './dto/student.dto';
import { StudentQueryDto } from './dto/student-query.dto';
import { CreateStudentGuardianDto, LinkGuardianDto, STUDENT_STATUSES, UpdateStudentGuardianDto, UpdateStudentStatusDto } from './dto/guardian.dto';
import { EnrollStudentDto, UpdateEnrollmentDto } from './dto/enrollment.dto';
import type { CreateAdmissionDto, AdmissionDocumentDto } from './dto/admission.dto';
import { PaginatedResult } from '../common/pagination/pagination.dto';
import { isStorageKey, StorageService, type StoredObject } from '../storage/storage.service';
import { generateGuardianNumber } from './guardian-number';

const SCIENCE_FIELDS = ['COMPUTER', 'BIOLOGY', 'ENGINEERING'];
const ART_FIELDS = ['MILITARY_SCIENCES', 'ISLAMIC_STUDIES'];

const safeUserSelect = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  status: true,
  createdAt: true,
} as const;

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  /**
   * Field-of-study rule for 2nd/3rd grade Secondary: SCIENCE track takes
   * COMPUTER | BIOLOGY | ENGINEERING, ART track takes MILITARY_SCIENCES |
   * ISLAMIC_STUDIES (required in both cases). Everywhere else the field
   * must be absent.
   */
  private assertEnrollmentFieldValid(
    schoolClass: { educationLevel: string; grade: string; track: string | null },
    field?: string | null,
  ): void {
    const isFieldSecondary =
      schoolClass.educationLevel === 'SECONDARY' &&
      (schoolClass.grade === 'SECOND' || schoolClass.grade === 'THIRD');
    if (!isFieldSecondary) {
      if (field) {
        throw new BadRequestException('Field of study applies to 2nd/3rd grade Secondary only');
      }
      return;
    }
    const allowed =
      schoolClass.track === 'SCIENCE' ? SCIENCE_FIELDS : schoolClass.track === 'ART' ? ART_FIELDS : [];
    const gradeLabel = schoolClass.grade === 'SECOND' ? '2nd' : '3rd';
    if (!field) {
      throw new BadRequestException(
        `Field of study is required for ${gradeLabel} grade Secondary ${schoolClass.track} (expected one of ${allowed.join(', ')})`,
      );
    }
    if (!allowed.includes(field)) {
      throw new BadRequestException(
        `Field must be one of ${allowed.join(', ')} for ${gradeLabel} grade Secondary ${schoolClass.track}`,
      );
    }
  }

  /**
   * Explicit guardian numbers are checked up front (clear 409); omitted ones
   * are auto-designed. A concurrent duplicate still surfaces via the unique
   * constraint mapped by the callers.
   */
  private async resolveGuardianNumber(tx: any, tenantId: string, explicit?: string): Promise<string> {
    const trimmed = explicit?.trim() || undefined;
    if (trimmed) {
      const clash = await tx.guardian.findFirst({
        where: { tenantId, guardianNumber: trimmed },
        select: { id: true },
      });
      if (clash) throw new ConflictException('Guardian number already exists');
      return trimmed;
    }
    try {
      return await generateGuardianNumber(tx, tenantId);
    } catch (error) {
      throw new ConflictException(
        error instanceof Error ? error.message : 'Could not assign a guardian number',
      );
    }
  }

  async createAdmission(tenantId: string, dto: CreateAdmissionDto) {
    if (!tenantId || !isUUID(tenantId)) {
      throw new BadRequestException('X-Tenant-Id must be a valid UUID');
    }
    const linkingGuardian = !!dto.guardian.guardianId;
    if (!dto.student.firstName?.trim() || (!linkingGuardian && !dto.guardian.firstName?.trim())) {
      throw new BadRequestException('Student and guardian names are required');
    }
    this.validateAdmissionDocuments(tenantId, dto);

    await this.prisma.withTenantRead(tenantId, async (tx) => {
      const [academicYear, schoolClass] = await Promise.all([
        tx.academicYear.findFirst({ where: { id: dto.enrollment.academicYearId, tenantId }, select: { id: true } }),
        tx.schoolClass.findFirst({ where: { id: dto.enrollment.classId, tenantId }, select: { id: true, educationLevel: true, grade: true, track: true } }),
      ]);
      if (!academicYear) throw new NotFoundException('Academic year not found');
      if (!schoolClass) throw new NotFoundException('Class not found');
      this.assertEnrollmentFieldValid(schoolClass, dto.enrollment.field);
    });

    const [studentPasswordHash, guardianPasswordHash] = await Promise.all([
      bcrypt.hash(dto.student.password, 12),
      linkingGuardian ? Promise.resolve('') : bcrypt.hash(dto.guardian.password, 12),
    ]);
    const studentId = randomUUID();
    let guardianId = linkingGuardian ? (dto.guardian.guardianId as string) : randomUUID();
    const movedDocuments: Array<{ input: AdmissionDocumentDto; stored: StoredObject }> = [];

    try {
      for (const document of dto.documents) {
        const stored = await this.storage.moveToStudent(document.objectKey, {
          tenantId,
          draftId: dto.draftId,
          documentType: document.documentType,
          studentId,
        });
        movedDocuments.push({ input: document, stored });
        if (stored.size !== document.size) {
          throw new BadRequestException(`Uploaded file size changed for ${document.originalName}`);
        }
      }

      return await this.prisma.withTenant(tenantId, async (tx) => {
        const studentEmail = dto.student.email?.trim() || undefined;
        const guardianEmail = dto.guardian.email?.trim() || undefined;
        const studentUser = await tx.user.create({
          data: {
            email: studentEmail,
            phone: dto.student.phone,
            firstName: dto.student.firstName.trim(),
            lastName: dto.student.lastName?.trim() || undefined,
            passwordHash: studentPasswordHash,
          },
          select: { id: true },
        });
        const studentRole = await this.ensureRole(tx, tenantId, 'STUDENT', 'Student');
        const studentMembership = await tx.tenantMembership.create({
          data: { tenantId, userId: studentUser.id, status: 'ACTIVE' },
          select: { id: true },
        });
        await tx.membershipRole.create({ data: { membershipId: studentMembership.id, roleId: studentRole.id } });
        let guardianUserId: string | null = null;
        if (!linkingGuardian) {
          const guardianUser = await tx.user.create({
            data: {
              email: guardianEmail,
              phone: dto.guardian.phone,
              firstName: dto.guardian.firstName.trim(),
              lastName: dto.guardian.lastName?.trim() || undefined,
              passwordHash: guardianPasswordHash,
            },
            select: { id: true },
          });
          guardianUserId = guardianUser.id;
          const guardianRole = await this.ensureRole(tx, tenantId, 'PARENT', 'Parent');
          const guardianMembership = await tx.tenantMembership.create({
            data: { tenantId, userId: guardianUser.id, status: 'ACTIVE' },
            select: { id: true },
          });
          await tx.membershipRole.create({ data: { membershipId: guardianMembership.id, roleId: guardianRole.id } });
        }

        const student = await tx.student.create({
          data: {
            id: studentId,
            tenantId,
            userId: studentUser.id,
            roleNumber: dto.student.roleNumber,
            firstName: dto.student.firstName.trim(),
            middleName: dto.student.middleName?.trim() || undefined,
            lastName: dto.student.lastName?.trim() || undefined,
            motherFullname: dto.student.motherFullname?.trim() || undefined,
            fatherFullname: dto.student.fatherFullname?.trim() || undefined,
            dateOfBirth: dto.student.dateOfBirth ? new Date(dto.student.dateOfBirth) : undefined,
            gender: dto.student.gender as any,
            educationLevel: dto.student.educationLevel as any,
            grade: dto.student.grade,
            phone: dto.student.phone,
            email: studentEmail,
            address: dto.student.address,
            isTransferred: dto.student.isTransferred ?? false,
            formerSchoolName: dto.student.formerSchoolName?.trim() || undefined,
            admissionDate: dto.student.admissionDate ? new Date(dto.student.admissionDate) : new Date(),
            photoUrl: movedDocuments.find(({ input }) => input.documentType === 'PROFILE_IMAGE')?.stored.objectKey,
            status: 'ACTIVE',
          },
          select: {
            id: true,
            roleNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            motherFullname: true,
            fatherFullname: true,
            dateOfBirth: true,
            gender: true,
            educationLevel: true,
            grade: true,
            phone: true,
            email: true,
            address: true,
            isTransferred: true,
            formerSchoolName: true,
            photoUrl: true,
            admissionDate: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            user: { select: safeUserSelect },
          },
        });
        const guardianSelect = {
          id: true,
          guardianNumber: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          address: true,
        } as const;
        let guardian: { id: string; guardianNumber: string | null; firstName: string; lastName: string | null; phone: string | null; email: string | null; address: string | null };
        if (linkingGuardian) {
          const existing = await tx.guardian.findFirst({
            where: { id: dto.guardian.guardianId, tenantId },
            select: guardianSelect,
          });
          if (!existing) throw new NotFoundException('Guardian not found');
          guardianId = existing.id;
          guardian = existing;
        } else {
          guardian = await tx.guardian.create({
            data: {
              id: guardianId,
              tenantId,
              userId: guardianUserId as string,
              guardianNumber: await this.resolveGuardianNumber(tx, tenantId, dto.guardian.guardianNumber),
              firstName: dto.guardian.firstName.trim(),
              lastName: dto.guardian.lastName?.trim() || undefined,
              phone: dto.guardian.phone,
              email: guardianEmail,
              address: dto.guardian.address,
            },
            select: guardianSelect,
          });
        }
        const guardianLink = await tx.studentGuardian.create({
          data: {
            studentId,
            guardianId,
            tenantId,
            relationship: dto.guardian.relationship,
            isPrimary: dto.guardian.isPrimary ?? true,
            canPickup: dto.guardian.canPickup ?? true,
            emergencyContact: dto.guardian.emergencyContact ?? false,
          },
          select: {
            relationship: true,
            isPrimary: true,
            canPickup: true,
            emergencyContact: true,
            guardian: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, guardianNumber: true } },
          },
        });
        const enrollment = await tx.studentEnrollment.create({
          data: {
            tenantId,
            studentId,
            academicYearId: dto.enrollment.academicYearId,
            classId: dto.enrollment.classId,
            status: (dto.enrollment.status as any) || 'ACTIVE',
            field: (dto.enrollment.field as any) || undefined,
          },
          select: {
            id: true,
            status: true,
            academicYear: { select: { id: true, name: true, startsOn: true, endsOn: true, isCurrent: true } },
            schoolClass: {
              select: {
                id: true,
                className: true,
              },
            },
          },
        });
        const documents: Array<{
          id: string;
          documentType: string;
          objectKey: string;
          originalName: string;
          contentType: string;
          size: number;
        }> = [];
        for (const { input, stored } of movedDocuments) {
          const document = await tx.studentDocument.create({
            data: {
              tenantId,
              studentId,
              documentType: input.documentType,
              objectKey: stored.objectKey,
              originalName: input.originalName.split(/[\\/]/).pop() || input.originalName,
              contentType: input.contentType,
              size: stored.size,
            },
            select: {
              id: true,
              documentType: true,
              objectKey: true,
              originalName: true,
              contentType: true,
              size: true,
            },
          });
          documents.push(document);
        }
        return {
          student: { ...student, enrollments: [enrollment], guardians: [guardianLink], documents },
          guardian,
          enrollment,
        };
      });
    } catch (error) {
      await Promise.all(
        movedDocuments.map(({ stored }) => this.storage.deleteObject(stored.objectKey).catch(() => undefined)),
      );
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('An admission with this role number or account already exists');
      }
      throw error;
    }
  }

  async create(tenantId: string, dto: CreateStudentDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          phone: dto.phone,
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordHash,
        },
      });
      const membership = await tx.tenantMembership.create({ data: { tenantId, userId: user.id, status: 'ACTIVE' } });
      let role = await tx.role.findFirst({ where: { tenantId, slug: 'STUDENT' } });
      if (!role) role = await tx.role.create({ data: { tenantId, name: 'Student', slug: 'STUDENT', scope: 'TENANT' } });
      await tx.membershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      return tx.student.create({
        data: {
          tenantId,
          userId: user.id,
          roleNumber: dto.roleNumber,
          firstName: dto.firstName,
          middleName: dto.middleName,
          lastName: dto.lastName,
          motherFullname: dto.motherFullname,
          fatherFullname: dto.fatherFullname,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          gender: dto.gender as any,
          educationLevel: dto.educationLevel as any,
          grade: dto.grade,
          phone: dto.phone,
          email: dto.email,
          address: dto.address,
          isTransferred: dto.isTransferred,
          formerSchoolName: dto.formerSchoolName,
          admissionDate: dto.admissionDate ? new Date(dto.admissionDate) : undefined,
        },
        select: { id: true, roleNumber: true, firstName: true, lastName: true, status: true, user: { select: safeUserSelect } },
      });
    });
  }

  async findAll(tenantId: string, query: StudentQueryDto): Promise<PaginatedResult<any>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const search = query.search?.trim();
  const where: any = {
    tenantId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.educationLevel ? { educationLevel: query.educationLevel } : {}),
    ...(query.grade !== undefined ? { grade: query.grade } : {}),
      ...(query.academicYearId || query.classId
        ? {
            enrollments: {
              some: {
                ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
                ...(query.classId ? { classId: query.classId } : {}),
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { roleNumber: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (page - 1) * limit;
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [data, total] = await Promise.all([
        tx.student.findMany({
          where,
          select: {
            id: true,
            roleNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            dateOfBirth: true,
            gender: true,
            educationLevel: true,
            grade: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            user: { select: safeUserSelect },
            enrollments: {
              orderBy: { enrolledOn: 'desc' },
              take: 1,
              select: {
                id: true,
                status: true,
                academicYear: { select: { id: true, name: true } },
                schoolClass: { select: { id: true, className: true, educationLevel: true, grade: true, track: true } },
              },
            },
            _count: { select: { enrollments: true, guardians: true, documents: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        tx.student.count({ where }),
      ]);
      return { data, total, page, limit };
    });
  }

  async findOne(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          roleNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          motherFullname: true,
          fatherFullname: true,
          dateOfBirth: true,
          gender: true,
          educationLevel: true,
          grade: true,
          phone: true,
          email: true,
          address: true,
          isTransferred: true,
          formerSchoolName: true,
          photoUrl: true,
          admissionDate: true,
          status: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          user: { select: safeUserSelect },
          guardians: { include: { guardian: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, guardianNumber: true } } } },
          documents: true,
          enrollments: {
            orderBy: { enrolledOn: 'desc' },
            include: {
              academicYear: { select: { id: true, name: true, startsOn: true, endsOn: true, isCurrent: true } },
              schoolClass: { select: { id: true, className: true, educationLevel: true, grade: true, track: true } },
            },
          },
        },
      });
      if (!student) throw new NotFoundException('Student not found');
      return student;
    });
  }

  async referenceData(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [years, classes] = await Promise.all([
        tx.academicYear.findMany({ where: { tenantId }, orderBy: { startsOn: 'desc' }, select: { id: true, name: true, startsOn: true, endsOn: true, isCurrent: true } }),
        tx.schoolClass.findMany({ where: { tenantId }, orderBy: { className: 'asc' }, select: { id: true, className: true, educationLevel: true, grade: true, track: true } }),
      ]);
      return { years, classes };
    });
  }

  async listEnrollments(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.studentEnrollment.findMany({
        where: { tenantId },
        orderBy: { enrolledOn: 'desc' },
        select: {
          id: true,
          status: true,
          enrolledOn: true,
          student: { select: { id: true, roleNumber: true, firstName: true, lastName: true } },
          academicYear: { select: { id: true, name: true } },
          schoolClass: { select: { id: true, className: true } },
        },
      }),
    );
  }

  async listGuardians(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.guardian.findMany({
        where: { tenantId },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          address: true,
          _count: { select: { students: true } },
        },
      }),
    );
  }

  /** Search-as-you-type for linking an existing guardian. Tenant-scoped: never leaks across tenants. */
  async searchGuardians(tenantId: string, query: string) {
    const q = query?.trim();
    if (!q) return [];
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.guardian.findMany({
        where: {
          tenantId,
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 20,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          _count: { select: { students: true } },
        },
      }),
    );
  }

  /** Guardian detail with every linked student and its per-link relationship. Tenant-scoped. */
  async findOneGuardian(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const guardian = await tx.guardian.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          address: true,
          students: {
            include: {
              student: { select: { id: true, firstName: true, lastName: true, roleNumber: true, status: true } },
            },
            orderBy: { student: { firstName: 'asc' } },
          },
        },
      });
      if (!guardian) throw new NotFoundException('Guardian not found');
      return guardian;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateStudentDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.student.findFirst({ where: { id, tenantId }, select: { id: true, userId: true } });
      if (!existing) throw new NotFoundException('Student not found');
      const data: any = {
        firstName: dto.firstName,
        middleName: dto.middleName,
        lastName: dto.lastName,
        motherFullname: dto.motherFullname,
        fatherFullname: dto.fatherFullname,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        gender: dto.gender as any,
        educationLevel: dto.educationLevel as any,
        grade: dto.grade,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        isTransferred: dto.isTransferred,
        formerSchoolName: dto.formerSchoolName,
        status: dto.status as any,
      };
      const student = await tx.student.update({ where: { id }, data });
      if (existing.userId && (dto.firstName || dto.lastName)) {
        await tx.user.update({ where: { id: existing.userId }, data: { firstName: dto.firstName, lastName: dto.lastName } });
      }
      return student;
    });
  }

  async remove(tenantId: string, id: string, confirm?: string) {
    if (confirm !== 'true') throw new BadRequestException('Destructive action requires confirm=true query parameter');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.student.findFirst({ where: { id, tenantId }, select: { id: true } });
      if (!existing) throw new NotFoundException('Student not found');
      await tx.student.delete({ where: { id } });
      return { deleted: true };
    });
  }

  async enroll(tenantId: string, studentId: string, dto: EnrollStudentDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, tenantId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found');
      const year = await tx.academicYear.findFirst({ where: { id: dto.academicYearId, tenantId } });
      if (!year) throw new NotFoundException('Academic year not found');
      const schoolClass = await tx.schoolClass.findFirst({
        where: { id: dto.classId, tenantId },
        select: { id: true, educationLevel: true, grade: true, track: true },
      });
      if (!schoolClass) throw new NotFoundException('Class not found');
      this.assertEnrollmentFieldValid(schoolClass, dto.field);
      const existing = await tx.studentEnrollment.findFirst({ where: { studentId, academicYearId: dto.academicYearId, tenantId } });
      if (existing) throw new ConflictException('Student already enrolled in this academic year');
      return tx.studentEnrollment.create({ data: { tenantId, studentId, academicYearId: dto.academicYearId, classId: dto.classId, status: (dto.status as any) || 'ACTIVE', field: (dto.field as any) || undefined }, include: { academicYear: true, schoolClass: true } });
    });
  }

  async transferStudent(tenantId: string, studentId: string, classId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, tenantId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found');
      const schoolClass = await tx.schoolClass.findFirst({ where: { id: classId, tenantId }, select: { id: true } });
      if (!schoolClass) throw new NotFoundException('Class not found');
      const enrollment = await tx.studentEnrollment.findFirst({ where: { studentId, tenantId, status: 'ACTIVE' }, select: { id: true, classId: true } });
      if (!enrollment) throw new BadRequestException('Student has no active enrollment');
      if (enrollment.classId === classId) throw new BadRequestException('Student is already enrolled in this class');
      return tx.studentEnrollment.update({ where: { id: enrollment.id }, data: { classId, status: 'ACTIVE' }, include: { academicYear: true, schoolClass: true } });
    });
  }

  async graduateStudent(tenantId: string, studentId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, tenantId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found');
      await tx.student.update({ where: { id: studentId }, data: { status: 'GRADUATED' } });
      await tx.studentEnrollment.updateMany({ where: { studentId, tenantId, status: 'ACTIVE' }, data: { status: 'COMPLETED' } });
      return tx.student.findUnique({ where: { id: studentId }, select: { id: true, roleNumber: true, firstName: true, lastName: true, status: true } });
    });
  }

  async updateEnrollment(tenantId: string, studentId: string, enrollmentId: string, dto: UpdateEnrollmentDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const enrollment = await tx.studentEnrollment.findFirst({ where: { id: enrollmentId, studentId, tenantId } });
      if (!enrollment) throw new NotFoundException('Enrollment not found');
      if (dto.classId !== undefined || dto.field !== undefined) {
        const classId = dto.classId ?? enrollment.classId;
        const schoolClass = await tx.schoolClass.findFirst({
          where: { id: classId, tenantId },
          select: { id: true, educationLevel: true, grade: true, track: true },
        });
        if (!schoolClass) throw new NotFoundException('Class not found');
        const field = dto.field !== undefined ? dto.field : (enrollment as { field?: string | null }).field;
        this.assertEnrollmentFieldValid(schoolClass, field);
      }
      return tx.studentEnrollment.update({ where: { id: enrollmentId }, data: { status: dto.status as any, classId: dto.classId, field: dto.field === undefined ? undefined : (dto.field as any) } });
    });
  }

  async linkGuardian(tenantId: string, studentId: string, dto: LinkGuardianDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, tenantId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found');
      const guardian = await tx.guardian.findFirst({ where: { id: dto.guardianId, tenantId }, select: { id: true } });
      if (!guardian) throw new NotFoundException('Guardian not found');
      const existing = await tx.studentGuardian.findFirst({ where: { studentId, guardianId: dto.guardianId } });
      if (existing) throw new ConflictException('Guardian already linked to this student');
      return tx.studentGuardian.create({ data: { studentId, guardianId: dto.guardianId, tenantId, relationship: dto.relationship, isPrimary: dto.isPrimary ?? false, canPickup: dto.canPickup ?? true, emergencyContact: dto.emergencyContact ?? false }, include: { guardian: true } });
    });
  }

  async unlinkGuardian(tenantId: string, studentId: string, guardianId: string) {
    // Legacy unlink path shares the safe semantics: the guardian row itself
    // is deleted only when its last link is gone (see removeStudentGuardian).
    return this.removeStudentGuardian(tenantId, studentId, guardianId);
  }

  async listStudentResults(tenantId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, tenantId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found');
      // No status filter here: the visibility rule (Major→PUBLISHED only,
      // Casual→SUBMITTED and beyond, DRAFT never) is presentation policy
      // applied by the consumer. Staff tooling sees the full history.
      return tx.examResult.findMany({
        where: { studentId, tenantId },
        include: {
          examSubject: {
            include: {
              exam: { select: { id: true, name: true, status: true, publishedAt: true } },
              classSubject: { include: { schoolClass: { select: { id: true, className: true } }, subject: true } },
              gradingScale: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async listStudentAttendanceRecords(tenantId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, tenantId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found');
      return tx.attendanceRecord.findMany({
        where: { studentId, tenantId },
        include: {
          attendanceSession: { select: { id: true, attendanceDate: true, classId: true } },
        },
        orderBy: { attendanceSession: { attendanceDate: 'desc' } },
      });
    });
  }

  async listStudentGuardians(tenantId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, tenantId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found');
      const links = await tx.studentGuardian.findMany({
        where: { studentId, tenantId },
        include: { guardian: true },
        orderBy: [{ isPrimary: 'desc' }, { guardian: { firstName: 'asc' } }],
      });
      if (links.length === 0) return links;
      // Sibling students sharing each guardian — one extra query, no N+1.
      const siblings = await tx.studentGuardian.findMany({
        where: {
          tenantId,
          guardianId: { in: links.map((link) => link.guardianId) },
          NOT: { studentId },
        },
        select: {
          guardianId: true,
          relationship: true,
          student: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      const siblingsByGuardian = new Map<string, typeof siblings>();
      for (const row of siblings) {
        siblingsByGuardian.set(row.guardianId, [...(siblingsByGuardian.get(row.guardianId) ?? []), row]);
      }
      return links.map((link) => ({
        ...link,
        siblingStudents: (siblingsByGuardian.get(link.guardianId) ?? []).map((row) => ({
          id: row.student.id,
          firstName: row.student.firstName,
          lastName: row.student.lastName,
          relationship: row.relationship,
        })),
      }));
    });
  }

  async createStudentGuardian(tenantId: string, studentId: string, dto: CreateStudentGuardianDto) {
    if (!dto.firstName?.trim()) throw new BadRequestException('Guardian first name is required');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, tenantId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found');
      const guardian = await tx.guardian.create({
        data: {
          tenantId,
          guardianNumber: await this.resolveGuardianNumber(tx, tenantId, dto.guardianNumber),
          firstName: dto.firstName.trim(),
          lastName: dto.lastName?.trim() || undefined,
          phone: dto.phone?.trim() || undefined,
          email: dto.email?.trim() || undefined,
          address: dto.address?.trim() || undefined,
        },
      });
      if (dto.isPrimary) {
        await tx.studentGuardian.updateMany({
          where: { studentId, tenantId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      try {
        return await tx.studentGuardian.create({
          data: {
            studentId,
            guardianId: guardian.id,
            tenantId,
            relationship: dto.relationship,
            isPrimary: dto.isPrimary ?? false,
            canPickup: dto.canPickup ?? true,
            emergencyContact: dto.emergencyContact ?? false,
          },
          include: { guardian: true },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('Guardian link could not be saved (duplicate or concurrent change)');
        }
        throw error;
      }
    });
  }

  async updateStudentGuardian(tenantId: string, studentId: string, guardianId: string, dto: UpdateStudentGuardianDto) {
    if (dto.firstName !== undefined && !dto.firstName.trim()) {
      throw new BadRequestException('Guardian first name cannot be blank');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const link = await tx.studentGuardian.findFirst({ where: { studentId, guardianId, tenantId } });
      if (!link) throw new NotFoundException('Guardian link not found');
      if (dto.isPrimary) {
        await tx.studentGuardian.updateMany({
          where: { studentId, tenantId, isPrimary: true, guardianId: { not: guardianId } },
          data: { isPrimary: false },
        });
      }
      const { relationship, isPrimary, canPickup, emergencyContact, ...guardianFields } = dto;
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(guardianFields)) {
        if (value !== undefined) data[key] = typeof value === 'string' ? value.trim() || undefined : value;
      }
      if (Object.keys(data).length > 0) {
        await tx.guardian.update({ where: { id_tenantId: { id: guardianId, tenantId } }, data });
      }
      try {
        return await tx.studentGuardian.update({
          where: { studentId_guardianId: { studentId, guardianId } },
          data: {
            ...(relationship !== undefined ? { relationship } : {}),
            ...(isPrimary !== undefined ? { isPrimary } : {}),
            ...(canPickup !== undefined ? { canPickup } : {}),
            ...(emergencyContact !== undefined ? { emergencyContact } : {}),
          },
          include: { guardian: true },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('Primary contact changed concurrently, please retry');
        }
        throw error;
      }
    });
  }

  async removeStudentGuardian(tenantId: string, studentId: string, guardianId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const link = await tx.studentGuardian.findFirst({ where: { studentId, guardianId, tenantId } });
      if (!link) throw new NotFoundException('Guardian link not found');
      await tx.studentGuardian.delete({ where: { studentId_guardianId: { studentId, guardianId } } });
      // Delete the guardian row itself only when no other student links to it.
      // Linked login accounts are deliberately preserved (re-linkable, possibly
      // holding other roles) — see DECISIONS.md.
      const remaining = await tx.studentGuardian.count({ where: { guardianId, tenantId } });
      if (remaining === 0) {
        await tx.guardian.delete({ where: { id_tenantId: { id: guardianId, tenantId } } });
      }
      return { deleted: true };
    });
  }

  async updateStatus(tenantId: string, studentId: string, dto: UpdateStudentStatusDto) {
    if (!STUDENT_STATUSES.includes(dto.status as never)) {
      throw new BadRequestException(`Invalid status (expected one of ${STUDENT_STATUSES.join(', ')})`);
    }
    if ((dto.status === 'POSTPONED' || dto.status === 'FIRED') && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required when postponing or firing a student');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.student.findFirst({ where: { id: studentId, tenantId } });
      if (!existing) throw new NotFoundException('Student not found');
      const now = new Date().toISOString();
      const reason = dto.reason?.trim() || undefined;
      const metadata = (existing.metadata ?? {}) as Record<string, Prisma.InputJsonValue>;
      const rawHistory = metadata.statusHistory;
      // `undefined` is not a JSON value, so an absent reason is stored as null —
      // otherwise Prisma rejects the whole write.
      const history: Prisma.InputJsonArray = Array.isArray(rawHistory) ? rawHistory : [];
      const entry = {
        from: existing.status,
        to: dto.status,
        reason: reason ?? null,
        at: now,
      };
      return tx.student.update({
        where: { id_tenantId: { id: studentId, tenantId } },
        data: {
          status: dto.status as any,
          metadata: { ...metadata, statusChange: entry, statusHistory: [...history, entry] },
        },
      });
    });
  }

  private validateAdmissionDocuments(tenantId: string, dto: CreateAdmissionDto): void {
    if (!dto.draftId || !isUUID(dto.draftId)) throw new BadRequestException('draftId must be a valid UUID');
    const prefix = `staging/${tenantId}/${dto.draftId}/`;
    const documentTypes = new Set<string>();
    const objectKeys = new Set<string>();
    const allowedContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

    for (const document of dto.documents) {
      if (
        !isStorageKey(document.objectKey) ||
        !document.objectKey.startsWith(`${prefix}${document.documentType}/`)
      ) {
        throw new BadRequestException('Document object key is outside the admission draft');
      }
      if (objectKeys.has(document.objectKey)) {
        throw new BadRequestException('Each uploaded document must be unique');
      }
      if (documentTypes.has(document.documentType)) {
        throw new BadRequestException('Each document type can only be uploaded once');
      }
      if (!allowedContentTypes.has(document.contentType)) {
        throw new BadRequestException(`Unsupported file type: ${document.contentType}`);
      }
      if (!document.originalName.trim()) {
        throw new BadRequestException('Document original name is required');
      }
      objectKeys.add(document.objectKey);
      documentTypes.add(document.documentType);
    }

    const hasIdentityDocument = ['NATIONAL_NUMBER', 'NATIONAL_CARD', 'PASSPORT'].some((documentType) => documentTypes.has(documentType));
    if (!hasIdentityDocument) {
      throw new BadRequestException('At least one student identity document is required');
    }
    if (dto.student.isTransferred && !documentTypes.has('TRANSFER_RESULT')) {
      throw new BadRequestException('Transfer result is required for a transferred student');
    }
    if (!dto.guardian.guardianId && !documentTypes.has('GUARDIAN_ID_PROOF')) {
      throw new BadRequestException('Guardian ID proof is required');
    }
  }

  private async ensureRole(tx: any, tenantId: string, slug: string, name: string) {
    const existing = await tx.role.findFirst({ where: { tenantId, slug } });
    if (existing) return existing;
    return tx.role.create({ data: { tenantId, name, slug, scope: 'TENANT' } });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002';
  }
}
