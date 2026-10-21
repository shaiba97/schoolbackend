import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { TeacherDocumentSource, TeacherStatus } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTeacherCredentialDto,
  CreateTeacherDto,
  TeacherQueryDto,
  UpdateTeacherCredentialDto,
  UpdateTeacherDto,
  UploadedTeacherDocumentDto,
} from './dto/teacher.dto';
import { PaginatedResult } from '../common/pagination/pagination.dto';
import { safeUserSelect } from '../common/safe-user.select';
import {
  isStorageKey,
  StorageService,
  type StoredObject,
} from '../storage/storage.service';
import { generateTeacherEmployeeNumber } from './employee-number';
import { toE164Phone } from '../common/phone/phone.util';
import { toTitleCase } from '../common/text/text.util';

const CREDENTIAL_DOCUMENT_TYPE = 'CREDENTIAL';
const ALLOWED_CREDENTIAL_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

@Injectable()
export class TeachersService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /**
   * Phones identify teachers and are how they sign in, so one number can back
   * only one account per school. Scoped to the tenant rather than made globally
   * unique: the same household number can legitimately exist in two schools, and
   * phone-based login is already tenant-scoped to match.
   */
  private async assertPhoneAvailable(
    tx: any,
    tenantId: string,
    phone: string,
    excludeUserId?: string,
  ): Promise<void> {
    const clash = await tx.user.findFirst({
      where: {
        phone,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        memberships: { some: { tenantId } },
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException('That phone number is already used by another person in this school');
    }
  }

  async create(tenantId: string, dto: CreateTeacherDto) {
    if (!tenantId || !isUUID(tenantId)) {
      throw new BadRequestException('X-Tenant-Id must be a valid UUID');
    }
    if (!dto.firstName?.trim()) {
      throw new BadRequestException('Teacher first name is required');
    }
    this.validateDocuments(tenantId, dto.documents ?? []);

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const teacherId = randomUUID();
    const movedDocuments: Array<{
      input: UploadedTeacherDocumentDto;
      stored: StoredObject;
    }> = [];

    try {
      for (const document of dto.documents ?? []) {
        const stored = await this.storage.moveToTeacher(document.objectKey, {
          tenantId,
          draftId: this.extractDraftId(document.objectKey, tenantId, document.documentType),
          documentType: document.documentType,
          teacherId,
        });
        movedDocuments.push({ input: document, stored });
        if (stored.size !== document.size) {
          throw new BadRequestException(
            `Uploaded file size changed for ${document.originalName}`,
          );
        }
      }

      return await this.prisma.withTenant(tenantId, async (tx) => {
        const phone = toE164Phone(dto.phone);
        await this.assertPhoneAvailable(tx, tenantId, phone);

        if (dto.departmentId) {
          const department = await tx.department.findFirst({
            where: { id: dto.departmentId, tenantId },
            select: { id: true },
          });
          if (!department) throw new NotFoundException('Department not found');
        }
        // Auto-design the employee ID when none is provided (e.g. `26CPM001`).
        // Explicit numbers keep the exact-check behavior above; generated ones
        // fall through to the DB unique constraint + P2002 mapping below.
        const explicitNumber = dto.employeeNumber?.trim() || undefined;
        if (explicitNumber) {
          const existingTeacher = await tx.teacher.findFirst({
            where: { tenantId, employeeNumber: explicitNumber },
            select: { id: true },
          });
          if (existingTeacher) throw new ConflictException('Employee number already exists');
        }
        const employeeNumber =
          explicitNumber ?? (await generateTeacherEmployeeNumber(tx, tenantId, dto.departmentId));

        const user = await tx.user.create({
          data: {
            phone,
            firstName: toTitleCase(dto.firstName),
            lastName: dto.lastName?.trim() ? toTitleCase(dto.lastName) : undefined,
            passwordHash,
          },
          select: { id: true },
        });
        const membership = await tx.tenantMembership.create({
          data: { tenantId, userId: user.id, status: 'ACTIVE' },
          select: { id: true },
        });
        const role = await this.ensureTeacherRole(tx, tenantId);
        await tx.membershipRole.create({
          data: { membershipId: membership.id, roleId: role.id },
        });

        const teacher = await tx.teacher.create({
          data: {
            id: teacherId,
            tenantId,
            userId: user.id,
            employeeNumber,
            hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
            specialization: dto.specialization,
            gender: dto.gender,
            dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
            departmentId: dto.departmentId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });

        await this.replaceDocuments(tx, tenantId, teacher.id, movedDocuments);

        return this.teacherSelect(tx, tenantId, teacher.id);
        // Teacher create fans out across ~10 sequential statements; the
        // default 5s interactive-transaction timeout expires over remote
        // connections (observed P2028 at 6s).
      }, { timeout: 30_000 });
    } catch (error) {
      await Promise.all(
        movedDocuments.map(({ stored }) =>
          this.storage.deleteObject(stored.objectKey).catch(() => undefined),
        ),
      );
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A teacher with this account or employee number already exists');
      }
      throw error;
    }
  }

  async findAll(tenantId: string, query: TeacherQueryDto): Promise<PaginatedResult<any>> {
    const { page = 1, limit = 50, search, status, departmentId } = query;
    const skip = (page - 1) * limit;
    const where: any = { tenantId };
    if (status) where.status = status;
    if (departmentId) where.departmentId = departmentId;
    if (search?.trim()) {
      const term = search.trim();
      where.OR = [
        { user: { firstName: { contains: term } } },
        { user: { lastName: { contains: term } } },
        { user: { email: { contains: term } } },
        { employeeNumber: { contains: term } },
      ];
    }

    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [data, total] = await Promise.all([
        tx.teacher.findMany({
          where,
          include: {
            user: { select: safeUserSelect },
            department: { select: { id: true, name: true } },
            documents: {
              // Full rows, not just keys: the edit form round-trips these
              // straight into the update payload, whose DTO requires every field.
              select: {
                id: true,
                documentType: true,
                objectKey: true,
                originalName: true,
                contentType: true,
                size: true,
                createdAt: true,
              },
            },
          },
          // Oldest first, so the list reads in the order teachers were entered.
          // `Teacher` has no timestamp column of its own, but its User is
          // created in the same transaction, so `user.createdAt` is exactly
          // when the teacher was entered. Ordering by `id` would sort by UUID,
          // which is random by construction.
          orderBy: [{ user: { createdAt: 'asc' } }, { id: 'asc' }],
          skip,
          take: limit,
        }),
        tx.teacher.count({ where }),
      ]);
      return { data, total, page, limit };
    });
  }

  async findOne(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, (tx) => this.teacherSelect(tx, tenantId, id));
  }

  /**
   * The employee number the next teacher would receive for this department.
   *
   * Advisory only: it reuses the exact assignment logic, but the value is not
   * reserved, so a concurrent create can shift the sequence. The unique
   * constraint on (tenant, employeeNumber) plus the caller's 409 mapping
   * remain the real guarantee.
   */
  async previewEmployeeNumber(tenantId: string, departmentId?: string) {
    const employeeNumber = await this.prisma.withTenantRead(tenantId, (tx) =>
      generateTeacherEmployeeNumber(tx, tenantId, departmentId),
    );
    return { employeeNumber };
  }

  async update(tenantId: string, id: string, dto: UpdateTeacherDto) {
    if (dto.documents) this.validateDocuments(tenantId, dto.documents);

    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 12) : undefined;
    const movedDocuments: Array<{ input: UploadedTeacherDocumentDto; stored: StoredObject }> = [];
    const orphanedKeys: string[] = [];
    let committed = false;

    // Move staged files BEFORE opening the transaction. A transaction must
    // never stay open across filesystem I/O: it holds a pooled connection
    // (pool starvation → P2028) plus row locks while doing non-DB work.
    // Moved files land in `movedDocuments`, which the catch block below
    // already compensates (deletes) if anything later fails.
    if (dto.documents) {
      for (const document of dto.documents) {
        if (!document.objectKey.startsWith(`staging/${tenantId}/`)) continue;
        const stored = await this.storage.moveToTeacher(document.objectKey, {
          tenantId,
          draftId: this.extractDraftId(document.objectKey, tenantId, document.documentType),
          documentType: document.documentType,
          teacherId: id,
        });
        movedDocuments.push({ input: document, stored });
        if (stored.size !== document.size) {
          throw new BadRequestException(
            `Uploaded file size changed for ${document.originalName}`,
          );
        }
      }
    }

    try {
      const result = await this.prisma.withTenant(tenantId, async (tx) => {
        const existing = await tx.teacher.findFirst({ where: { id, tenantId } });
        if (!existing) throw new NotFoundException('Teacher not found');

        if (dto.departmentId) {
          const department = await tx.department.findFirst({
            where: { id: dto.departmentId, tenantId },
            select: { id: true },
          });
          if (!department) throw new NotFoundException('Department not found');
        }

        if (dto.phone !== undefined && dto.phone.trim()) {
          const phone = toE164Phone(dto.phone);
          await this.assertPhoneAvailable(tx, tenantId, phone, existing.userId);
          await tx.user.update({ where: { id: existing.userId }, data: { phone } });
        }
        if (dto.employeeNumber !== undefined && dto.employeeNumber?.trim()) {
          const otherTeacher = await tx.teacher.findFirst({
            where: { tenantId, employeeNumber: dto.employeeNumber.trim(), id: { not: existing.id } },
            select: { id: true },
          });
          if (otherTeacher) throw new ConflictException('Employee number already exists');
        }

        if (dto.firstName || dto.lastName || passwordHash) {
          await tx.user.update({
            where: { id: existing.userId },
            data: {
              firstName: dto.firstName ? toTitleCase(dto.firstName) : undefined,
              lastName: dto.lastName === undefined ? undefined : toTitleCase(dto.lastName),
              passwordHash,
            },
          });
        }

        const oldDocuments = dto.documents
          ? await tx.teacherDocument.findMany({
              where: { tenantId, teacherId: existing.id },
              select: { documentType: true, objectKey: true },
            })
          : [];

        const teacher = await tx.teacher.update({
          where: { id: existing.id },
          data: {
            employeeNumber: dto.employeeNumber === undefined ? undefined : dto.employeeNumber?.trim() || undefined,
            hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
            specialization: dto.specialization,
            gender: dto.gender,
            dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
            departmentId: dto.departmentId,
            status: dto.status,
          },
          select: { id: true },
        });

        if (dto.documents) {
          const keptKeys = new Set(dto.documents.map((doc) => doc.objectKey));
          for (const oldDocument of oldDocuments) {
            if (!keptKeys.has(oldDocument.objectKey)) orphanedKeys.push(oldDocument.objectKey);
          }
          // Pure mapping only — files were already moved before the
          // transaction opened (see above). No I/O inside the tx.
          const finalDocuments: Array<{ input: UploadedTeacherDocumentDto; stored: StoredObject }> =
            dto.documents.map((document) => {
              if (!document.objectKey.startsWith(`staging/${tenantId}/`)) {
                return {
                  input: document,
                  stored: {
                    objectKey: document.objectKey,
                    originalName: document.originalName,
                    contentType: document.contentType,
                    size: document.size,
                  },
                };
              }
              const moved = movedDocuments.find(
                (m) => m.input.objectKey === document.objectKey,
              );
              if (!moved) {
                throw new BadRequestException(
                  `Staged file ${document.originalName} was not moved before saving`,
                );
              }
              return moved;
            });
          await tx.teacherDocument.deleteMany({
            where: { tenantId, teacherId: existing.id },
          });
          await this.createDocumentRows(tx, tenantId, existing.id, finalDocuments);
        }

        return this.teacherSelect(tx, tenantId, teacher.id);
      });
      committed = true;
      return result;
    } catch (error) {
      await Promise.all(
        movedDocuments.map(({ stored }) =>
          this.storage.deleteObject(stored.objectKey).catch(() => undefined),
        ),
      );
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A teacher with this account or employee number already exists');
      }
      throw error;
    } finally {
      if (committed) {
        await Promise.all(
          orphanedKeys.map((key) => this.storage.deleteObject(key).catch(() => undefined)),
        );
      }
    }
  }

  async updateStatus(tenantId: string, id: string, status: TeacherStatus) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.teacher.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Teacher not found');
      return tx.teacher.update({
        where: { id },
        data: { status },
        select: { id: true, status: true },
      });
    });
  }

  /**
   * Remove a teacher, but only when nothing depends on them.
   *
   * Every relation below cascades at the database level, so an unguarded
   * delete would silently wipe sections they head, subjects they teach,
   * attendance history and invigilation duties. Those are refused with a 409
   * naming the blocker so the caller can deactivate instead — deactivation is
   * the reversible option, deletion is not.
   *
   * The linked `User` row is never deleted: audit logs and notifications
   * reference it, and the email stays reserved. It is deactivated instead, so
   * no working login survives the teacher.
   */
  async delete(tenantId: string, id: string) {
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const teacher = await tx.teacher.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          userId: true,
          _count: {
            select: {
              classTeacherFor: true,
              classSubjects: true,
              attendanceSessions: true,
              invigilationDuties: true,
            },
          },
        },
      });
      if (!teacher) throw new NotFoundException('Teacher not found');

      const blockers: string[] = [];
      if (teacher._count.classTeacherFor > 0) {
        blockers.push(`heads ${teacher._count.classTeacherFor} class(es)`);
      }
      if (teacher._count.classSubjects > 0) {
        blockers.push(`teaches ${teacher._count.classSubjects} subject assignment(s)`);
      }
      if (teacher._count.attendanceSessions > 0) {
        blockers.push(`has ${teacher._count.attendanceSessions} attendance record(s)`);
      }
      if (teacher._count.invigilationDuties > 0) {
        blockers.push(`holds ${teacher._count.invigilationDuties} invigilation duty(ies)`);
      }
      if (blockers.length > 0) {
        throw new ConflictException(
          `Cannot delete this teacher: they ${blockers.join(', ')}. Deactivate the teacher instead.`,
        );
      }

      const documents = await tx.teacherDocument.findMany({
        where: { tenantId, teacherId: id },
        select: { objectKey: true },
      });
      const credentials = await tx.teacherCredential.findMany({
        where: { tenantId, teacherId: id },
        select: { objectKey: true },
      });

      // Explicit child deletes rather than relying on cascades: the object keys
      // must be captured for file cleanup, and doing it here keeps the
      // guarantee in one visible place.
      await tx.teacherDocument.deleteMany({ where: { tenantId, teacherId: id } });
      await tx.teacherCredential.deleteMany({ where: { tenantId, teacherId: id } });
      await tx.teacher.delete({ where: { id_tenantId: { id, tenantId } } });

      return {
        userId: teacher.userId,
        objectKeys: [...documents, ...credentials].map((doc) => doc.objectKey),
      };
    });

    // The user row survives (audit logs, notifications, reserved email) but
    // must not remain a usable login.
    await this.prisma.user
      .update({ where: { id: result.userId }, data: { status: 'INACTIVE' } })
      .catch(() => undefined);
    await Promise.all(
      result.objectKeys.map((objectKey) =>
        this.storage.deleteObject(objectKey).catch(() => undefined),
      ),
    );

    return { deleted: true, id };
  }

  // -------------------------------------------------------------------------
  // NAMED CREDENTIAL DOCUMENTS
  //
  // These are independent of the teacher's create/update payload: a teacher
  // can hold any number of them, each with a display name, added and removed
  // from the teacher record at any time. Files are moved out of staging
  // before the transaction opens, matching the rule used elsewhere in this
  // service (a transaction must never span filesystem I/O).
  // -------------------------------------------------------------------------

  private credentialSelect() {
    return {
      id: true,
      title: true,
      objectKey: true,
      originalName: true,
      contentType: true,
      size: true,
      source: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  async listCredentials(tenantId: string, teacherId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const teacher = await tx.teacher.findFirst({
        where: { id: teacherId, tenantId },
        select: { id: true },
      });
      if (!teacher) throw new NotFoundException('Teacher not found');

      return tx.teacherCredential.findMany({
        where: { tenantId, teacherId },
        select: this.credentialSelect(),
        orderBy: [{ title: 'asc' }, { createdAt: 'asc' }],
      });
    });
  }

  async addCredential(
    tenantId: string,
    teacherId: string,
    dto: CreateTeacherCredentialDto,
  ) {
    this.assertCredentialUpload(tenantId, dto.objectKey, dto.contentType, dto.size);

    const stored = await this.storage.moveToTeacher(dto.objectKey, {
      tenantId,
      draftId: this.extractDraftId(dto.objectKey, tenantId, CREDENTIAL_DOCUMENT_TYPE),
      documentType: CREDENTIAL_DOCUMENT_TYPE,
      teacherId,
    });
    if (stored.size !== dto.size) {
      await this.storage.deleteObject(stored.objectKey).catch(() => undefined);
      throw new BadRequestException(
        `Uploaded file size changed for ${dto.originalName}`,
      );
    }

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const teacher = await tx.teacher.findFirst({
          where: { id: teacherId, tenantId },
          select: { id: true },
        });
        if (!teacher) throw new NotFoundException('Teacher not found');

        try {
          return await tx.teacherCredential.create({
            data: {
              tenantId,
              teacherId,
              title: dto.title.trim(),
              objectKey: stored.objectKey,
              originalName: dto.originalName.split(/[\\/]/).pop() || dto.originalName,
              contentType: dto.contentType,
              size: stored.size,
              source: dto.source ?? TeacherDocumentSource.ACADEMIC_AFFAIRS,
            },
            select: this.credentialSelect(),
          });
        } catch (error) {
          if (this.isUniqueConstraintError(error)) {
            throw new ConflictException(
              `This teacher already has a document named "${dto.title.trim()}"`,
            );
          }
          throw error;
        }
      });
    } catch (error) {
      // The row never landed, so the moved file is now an orphan.
      await this.storage.deleteObject(stored.objectKey).catch(() => undefined);
      throw error;
    }
  }

  async updateCredential(
    tenantId: string,
    teacherId: string,
    credentialId: string,
    dto: UpdateTeacherCredentialDto,
  ) {
    const replacementKey = dto.objectKey;
    if (replacementKey) {
      if (!dto.originalName || !dto.contentType || !dto.size) {
        throw new BadRequestException(
          'Replacing a document requires originalName, contentType and size',
        );
      }
      this.assertCredentialUpload(tenantId, replacementKey, dto.contentType, dto.size);
    }
    if (dto.title === undefined && !replacementKey && dto.source === undefined) {
      throw new BadRequestException('Provide a title, a source, or a replacement file');
    }

    let stored: StoredObject | undefined;
    if (replacementKey) {
      stored = await this.storage.moveToTeacher(replacementKey, {
        tenantId,
        draftId: this.extractDraftId(replacementKey, tenantId, CREDENTIAL_DOCUMENT_TYPE),
        documentType: CREDENTIAL_DOCUMENT_TYPE,
        teacherId,
      });
      if (stored.size !== dto.size) {
        await this.storage.deleteObject(stored.objectKey).catch(() => undefined);
        throw new BadRequestException(
          `Uploaded file size changed for ${dto.originalName as string}`,
        );
      }
    }

    let oldObjectKey: string | undefined;
    try {
      const result = await this.prisma.withTenant(tenantId, async (tx) => {
        const existing = await tx.teacherCredential.findFirst({
          where: { id: credentialId, tenantId, teacherId },
        });
        if (!existing) throw new NotFoundException('Document not found');
        oldObjectKey = existing.objectKey;

        try {
          return await tx.teacherCredential.update({
            where: { id_tenantId: { id: credentialId, tenantId } },
            data: {
              ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
              ...(dto.source !== undefined ? { source: dto.source } : {}),
              ...(stored
                ? {
                    objectKey: stored.objectKey,
                    originalName:
                      (dto.originalName as string).split(/[\\/]/).pop() ||
                      (dto.originalName as string),
                    contentType: dto.contentType as string,
                    size: stored.size,
                  }
                : {}),
            },
            select: this.credentialSelect(),
          });
        } catch (error) {
          if (this.isUniqueConstraintError(error)) {
            throw new ConflictException(
              `This teacher already has a document named "${dto.title?.trim()}"`,
            );
          }
          throw error;
        }
      });

      if (stored && oldObjectKey && oldObjectKey !== stored.objectKey) {
        await this.storage.deleteObject(oldObjectKey).catch(() => undefined);
      }
      return result;
    } catch (error) {
      // The row still points at the previous file, so the replacement we moved
      // is an orphan and must not be left behind.
      if (stored) await this.storage.deleteObject(stored.objectKey).catch(() => undefined);
      throw error;
    }
  }

  async deleteCredential(tenantId: string, teacherId: string, credentialId: string) {
    const removed = await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.teacherCredential.findFirst({
        where: { id: credentialId, tenantId, teacherId },
        select: { id: true, objectKey: true },
      });
      if (!existing) throw new NotFoundException('Document not found');

      await tx.teacherCredential.delete({
        where: { id_tenantId: { id: credentialId, tenantId } },
      });
      return existing;
    });

    await this.storage.deleteObject(removed.objectKey).catch(() => undefined);
    return { deleted: true, id: credentialId };
  }

  private assertCredentialUpload(
    tenantId: string,
    objectKey: string,
    contentType: string,
    size: number,
  ): void {
    if (!isStorageKey(objectKey)) {
      throw new BadRequestException('Document object key is invalid');
    }
    if (!this.parseStagedKey(objectKey, tenantId, CREDENTIAL_DOCUMENT_TYPE)) {
      throw new BadRequestException('Document must be a staged upload for this tenant');
    }
    if (!ALLOWED_CREDENTIAL_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(`Unsupported file type: ${contentType}`);
    }
    if (size < 1) {
      throw new BadRequestException('Document file is empty');
    }
  }

  private async teacherSelect(tx: any, tenantId: string, id: string) {
    const teacher = await tx.teacher.findFirst({
      where: { id, tenantId },
      include: {
        user: { select: safeUserSelect },
        department: { select: { id: true, name: true } },
        documents: {
          select: {
            id: true,
            documentType: true,
            objectKey: true,
            originalName: true,
            contentType: true,
            size: true,
            createdAt: true,
          },
        },
        credentials: {
          select: this.credentialSelect(),
          orderBy: [{ title: 'asc' }, { createdAt: 'asc' }],
        },
        classSubjects: {
          include: { schoolClass: true, subject: true },
        },
        classTeacherFor: true,
      },
    });
    if (!teacher) throw new NotFoundException('Teacher not found');
    return teacher;
  }

  private validateDocuments(tenantId: string, documents: UploadedTeacherDocumentDto[]): void {
    const documentTypes = new Set<string>();
    const objectKeys = new Set<string>();
    const allowedContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

    for (const document of documents) {
      if (!isStorageKey(document.objectKey)) {
        throw new BadRequestException('Document object key is invalid');
      }
      const staged = this.parseStagedKey(document.objectKey, tenantId, document.documentType);
      const finalPrefix = `teachers/${tenantId}/`;
      if (!staged && !document.objectKey.startsWith(finalPrefix)) {
        throw new BadRequestException('Document object key is outside the teacher upload scope');
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
  }

  private parseStagedKey(
    objectKey: string,
    tenantId: string,
    documentType: string,
  ): { draftId: string } | null {
    const escapedTenant = tenantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(
      `^staging/${escapedTenant}/([0-9a-fA-F-]{36})/${documentType}/`,
    );
    const match = objectKey.match(matcher);
    return match ? { draftId: match[1] } : null;
  }

  private extractDraftId(objectKey: string, tenantId: string, documentType: string): string {
    const staged = this.parseStagedKey(objectKey, tenantId, documentType);
    if (!staged) throw new BadRequestException('Document object key has no valid draft');
    return staged.draftId;
  }

  private async replaceDocuments(
    tx: any,
    tenantId: string,
    teacherId: string,
    movedDocuments: Array<{ input: UploadedTeacherDocumentDto; stored: StoredObject }>,
  ) {
    await tx.teacherDocument.deleteMany({ where: { tenantId, teacherId } });
    await this.createDocumentRows(tx, tenantId, teacherId, movedDocuments);
  }

  private async createDocumentRows(
    tx: any,
    tenantId: string,
    teacherId: string,
    movedDocuments: Array<{ input: UploadedTeacherDocumentDto; stored: StoredObject }>,
  ) {
    for (const { input, stored } of movedDocuments) {
      await tx.teacherDocument.create({
        data: {
          tenantId,
          teacherId,
          documentType: input.documentType,
          objectKey: stored.objectKey,
          originalName: input.originalName.split(/[\\/]/).pop() || input.originalName,
          contentType: input.contentType,
          size: stored.size,
        },
        select: { id: true },
      });
    }
  }

  private async ensureTeacherRole(tx: any, tenantId: string) {
    const existing = await tx.role.findFirst({ where: { tenantId, slug: 'TEACHER' } });
    if (existing) return existing;
    return tx.role.create({
      data: { tenantId, name: 'Teacher', slug: 'TEACHER', scope: 'TENANT' },
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}