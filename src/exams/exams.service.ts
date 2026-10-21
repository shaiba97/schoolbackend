import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, type StoredObject } from '../storage/storage.service';
import { RealtimeGateway, roomsForTarget } from '../realtime/realtime.gateway';
import { CreateExamDto, CreateExamSubjectDto, EXAM_STATUSES, UpdateExamDto, BulkEnterMarksDto, ExamSampleDto } from './dto/exam.dto';
import { PaginatedResult } from '../common/pagination/pagination.dto';

// Authenticated caller. Controllers always supply this; service methods treat
// a missing actor as a legacy internal call and skip authorship enforcement.
export interface ExamActor {
  userId: string;
  roles: string[];
}

function isStaffAdmin(roles: string[] = []): boolean {
  return roles.includes('ADMIN') || roles.includes('ACADEMIC_ADMIN');
}

type ExamTx = Prisma.TransactionClient;

type ModerationQueueSubject = {
  examSubjectId: string;
  subjectName: string;
  submitted: number;
  total: number;
  allSubmitted: boolean;
};

type ModerationQueueClass = {
  classId: string;
  className: string;
  subjects: ModerationQueueSubject[];
};

type ModerationQueueExam = {
  examId: string;
  examName: string;
  status: string;
  examType: string | null;
  publishedAt: Date | null;
  classes: ModerationQueueClass[];
};

@Injectable()
export class ExamsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private realtime: RealtimeGateway,
  ) {}

  private validateExamSample(tenantId: string, sample: ExamSampleDto) {
    if (!sample.objectKey.startsWith(`staging/${tenantId}/`)) {
      throw new BadRequestException('Sample file must be a staged upload');
    }
  }

  // Class-validator can bound each field but not compare two of them, so the
  // cross-field rules live here and run before any transaction or file I/O.
  private assertDateOrder(startsOn?: string, endsOn?: string) {
    if (startsOn && endsOn && new Date(endsOn) < new Date(startsOn)) {
      throw new BadRequestException('End date must be on or after the start date');
    }
  }

  private assertMarksValid(maxMarks: number, passingMarks?: number) {
    if (passingMarks != null && passingMarks > maxMarks) {
      throw new BadRequestException('Passing marks cannot exceed max marks');
    }
  }

  // A teacher may touch only exams they authored (staff admins may touch
  // any). Legacy exams with no author are staff-admin-only.
  private assertCanEditExam(existing: { authorId?: string | null }, actor?: ExamActor) {
    if (!actor) return;
    if (isStaffAdmin(actor.roles)) return;
    if (actor.roles.includes('TEACHER') && existing.authorId && existing.authorId === actor.userId) return;
    throw new ForbiddenException('You can only edit exams you authored');
  }

  // Teachers may fan an exam out only across classes they actually teach
  // (ClassSubject assignment). Staff admins are unrestricted.
  private async assertClassesWithinTeacherScope(
    tx: any,
    tenantId: string,
    actor: ExamActor | undefined,
    classIds: string[],
  ) {
    if (!actor || isStaffAdmin(actor.roles) || !actor.roles.includes('TEACHER')) return;
    const myClasses = await tx.classSubject.findMany({
      where: { tenantId, teacher: { userId: actor.userId } },
      select: { classId: true },
    });
    const mine = new Set(myClasses.map((row) => row.classId));
    const outside = classIds.filter((classId) => !mine.has(classId));
    if (outside.length > 0) {
      throw new ForbiddenException('You can only create exams for classes you teach');
    }
  }

  // Throws when the exam already has room assignments: the first assignment
  // partially locks the exam structure (subjects can no longer change, but
  // scalar fields like name and dates stay editable).
  private assertNotRoomLocked(existing: { _count?: { examRoomAssignments?: number } }) {
    if ((existing._count?.examRoomAssignments ?? 0) > 0) {
      throw new ConflictException(
        'This exam already has room assignments; remove them before changing its subjects',
      );
    }
  }

  async create(tenantId: string, dto: CreateExamDto, actor?: ExamActor) {
    if (dto.sample) this.validateExamSample(tenantId, dto.sample);
    this.assertDateOrder(dto.startsOn, dto.endsOn);
    for (const s of dto.subjects ?? []) this.assertMarksValid(s.maxMarks, s.passingMarks);

    // Move the staged sample BEFORE opening the transaction: a tx must
    // never stay open across filesystem I/O (pool starvation → P2028).
    const examId = randomUUID();
    let movedSample: StoredObject | undefined;
    if (dto.sample) {
      movedSample = await this.storage.moveToExam(dto.sample.objectKey, {
        tenantId,
        draftId: examId,
        documentType: 'EXAM_SAMPLE',
        examId,
      });
      if (movedSample.size !== dto.sample.size) {
        await this.storage.deleteObject(movedSample.objectKey).catch(() => undefined);
        throw new BadRequestException(
          `Uploaded file size changed for ${dto.sample.originalName}`,
        );
      }
    }

    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const year = await tx.academicYear.findFirst({ where: { id: dto.academicYearId, tenantId } });
        if (!year) throw new NotFoundException('Academic year not found');

        if (dto.examTypeId) {
          const type = await tx.examType.findFirst({ where: { id: dto.examTypeId, tenantId } });
          if (!type) throw new NotFoundException('Exam type not found');
        }

        if (dto.termId) {
          const term = await tx.academicTerm.findFirst({
            where: { id: dto.termId, academicYearId: dto.academicYearId, tenantId },
          });
          if (!term) throw new NotFoundException('Academic term not found for the selected year');
        }

        // classIds fan-out: one Exam row per class sharing an examGroupId so
        // the list can show a row per class while the group stays editable as
        // one unit. Without classIds this is a single standalone exam.
        const requested: string[] = dto.classIds?.length ? [...new Set(dto.classIds)] : [];
        await this.assertClassesWithinTeacherScope(tx, tenantId, actor, requested);
        for (const classId of requested) {
          const schoolClass = await tx.schoolClass.findFirst({ where: { id: classId, tenantId } });
          if (!schoolClass) throw new NotFoundException('Class not found in this tenant');
        }

        // Resolve each subject's class up front so a subject can never land in
        // an exam row for a different class.
        const subjectClasses = new Map<string, string>();
        for (const s of dto.subjects ?? []) {
          const classSubject = await tx.classSubject.findFirst({
            where: { id: s.classSubjectId, tenantId },
            select: { id: true, classId: true },
          });
          if (!classSubject) {
            throw new NotFoundException('Class-subject assignment not found in this tenant');
          }
          subjectClasses.set(s.classSubjectId, (classSubject as { classId: string }).classId);
        }
        if (requested.length) {
          for (const [classSubjectId, classId] of subjectClasses) {
            if (!requested.includes(classId)) {
              throw new BadRequestException(
                `Subject ${classSubjectId} belongs to a class outside the requested classes`,
              );
            }
          }
        }

        const examGroupId = requested.length > 1 ? randomUUID() : null;
        const classRows: (string | null)[] = requested.length ? requested : [null];
        const created: any[] = [];
        for (const classId of classRows) {
          // Reuse the pre-generated id for the standalone path so it stays
          // linked to the staged sample moved before the transaction.
          const rowId = classId ? randomUUID() : examId;
          const exam = await tx.exam.create({
            data: {
              id: rowId,
              tenantId,
              academicYearId: dto.academicYearId,
              termId: dto.termId,
              examTypeId: dto.examTypeId,
              name: dto.name,
              startsOn: dto.startsOn ? new Date(dto.startsOn) : undefined,
              endsOn: dto.endsOn ? new Date(dto.endsOn) : undefined,
              sampleObjectKey: classId ? undefined : movedSample?.objectKey,
              authorId: actor?.userId,
              examGroupId,
            },
          });

          const ownSubjects = (dto.subjects ?? []).filter(
            (s) => !classId || subjectClasses.get(s.classSubjectId) === classId,
          );
          await this.createExamSubjects(tx, tenantId, exam.id, ownSubjects);

          created.push(
            await tx.exam.findFirst({
              where: { id: exam.id, tenantId },
              include: {
                examSubjects: {
                  include: {
                    classSubject: { include: { schoolClass: true, subject: true, teacher: true } },
                    gradingScale: true,
                    results: { include: { student: true } },
                  },
                },
              },
            }),
          );
        }

        return requested.length ? created : created[0];
      });
    } catch (error) {
      if (movedSample) {
        await this.storage.deleteObject(movedSample.objectKey).catch(() => undefined);
      }
      throw error;
    }
  }

  private async createExamSubjects(tx: any, tenantId: string, examId: string, subjects: CreateExamSubjectDto[]) {
    for (const s of subjects) {
      if (s.gradingScaleId) {
        const scale = await tx.gradingScale.findFirst({
          where: { id: s.gradingScaleId, tenantId },
          select: { id: true },
        });
        if (!scale) throw new NotFoundException('Grading scale not found in this tenant');
      }
      await tx.examSubject.create({
        data: {
          tenantId,
          examId,
          classSubjectId: s.classSubjectId,
          examDate: s.examDate ? new Date(s.examDate) : undefined,
          maxMarks: s.maxMarks,
          passingMarks: s.passingMarks,
          weight: s.weight,
          gradingScaleId: s.gradingScaleId,
        },
      });
    }
  }

  async findAll(tenantId: string, yearId?: string, page = 1, limit = 50): Promise<PaginatedResult<any>> {
    const skip = (page - 1) * limit;
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const where = { tenantId, academicYearId: yearId };
      const [data, total] = await Promise.all([
        tx.exam.findMany({
          where,
          include: {
            author: { select: { id: true, firstName: true, lastName: true } },
            _count: { select: { examSubjects: true, examRoomAssignments: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        tx.exam.count({ where }),
      ]);
      return { data, total, page, limit };
    });
  }

  async findOne(tenantId: string, id: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const exam = await tx.exam.findFirst({
        where: { id, tenantId },
        include: {
          author: { select: { id: true, firstName: true, lastName: true } },
          examSubjects: {
            include: {
              classSubject: { include: { schoolClass: true, subject: true, teacher: true } },
              gradingScale: true,
              results: { include: { student: true } },
            },
          },
          examRoomAssignments: {
            include: {
              hall: true,
              _count: { select: { students: true, invigilators: true } },
            },
          },
        },
      });
      if (!exam) throw new NotFoundException('Exam not found');
      return exam;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateExamDto, actor?: ExamActor) {
    if (dto.sample) this.validateExamSample(tenantId, dto.sample);
    this.assertDateOrder(dto.startsOn, dto.endsOn);

    // Move a replacement sample BEFORE opening the transaction.
    let movedSample: StoredObject | undefined;
    if (dto.sample) {
      movedSample = await this.storage.moveToExam(dto.sample.objectKey, {
        tenantId,
        draftId: id,
        documentType: 'EXAM_SAMPLE',
        examId: id,
      });
      if (movedSample.size !== dto.sample.size) {
        await this.storage.deleteObject(movedSample.objectKey).catch(() => undefined);
        throw new BadRequestException(
          `Uploaded file size changed for ${dto.sample.originalName}`,
        );
      }
    }

    let oldSampleKey: string | null = null;
    try {
      const updated = await this.prisma.withTenant(tenantId, async (tx) => {
        const existing = await tx.exam.findFirst({ where: { id, tenantId } });
        if (!existing) throw new NotFoundException('Exam not found');

        this.assertCanEditExam(existing, actor);
        // Status transitions (including publish) stay staff-admin-only: a
        // teacher author may rename and reschedule, never release results.
        if (dto.status !== undefined && actor && !isStaffAdmin(actor.roles)) {
          throw new ForbiddenException('Only staff admins can change the exam status');
        }

        if (dto.examTypeId !== undefined) {
          if (dto.examTypeId) {
            const type = await tx.examType.findFirst({ where: { id: dto.examTypeId, tenantId } });
            if (!type) throw new NotFoundException('Exam type not found');
          }
        }

        if (dto.sample !== undefined) {
          oldSampleKey = existing.sampleObjectKey;
        }

        if (dto.status !== undefined && !(EXAM_STATUSES as readonly string[]).includes(dto.status)) {
          throw new BadRequestException(`Invalid status (expected one of ${EXAM_STATUSES.join(', ')})`);
        }

        return tx.exam.update({
          where: { id },
          data: {
            name: dto.name,
            examTypeId: dto.examTypeId === undefined ? undefined : dto.examTypeId || null,
            startsOn: dto.startsOn ? new Date(dto.startsOn) : undefined,
            endsOn: dto.endsOn ? new Date(dto.endsOn) : undefined,
            status: dto.status as any,
            sampleObjectKey:
              dto.sample === undefined ? undefined : dto.sample === null ? null : movedSample?.objectKey,
          },
        });
      });

      if (oldSampleKey) {
        await this.storage.deleteObject(oldSampleKey).catch(() => undefined);
      }
      return updated;
    } catch (error) {
      if (movedSample) {
        await this.storage.deleteObject(movedSample.objectKey).catch(() => undefined);
      }
      throw error;
    }
  }

  async addSubject(tenantId: string, examId: string, dto: CreateExamSubjectDto) {
    this.assertMarksValid(dto.maxMarks, dto.passingMarks);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const exam = await tx.exam.findFirst({
        where: { id: examId, tenantId },
        include: { _count: { select: { examRoomAssignments: true } } },
      });
      if (!exam) throw new NotFoundException('Exam not found');
      this.assertNotRoomLocked(exam);

      const classSubject = await tx.classSubject.findFirst({
        where: { id: dto.classSubjectId, tenantId },
      });
      if (!classSubject) throw new NotFoundException('Class-subject assignment not found');

      if (dto.gradingScaleId) {
        const scale = await tx.gradingScale.findFirst({
          where: { id: dto.gradingScaleId, tenantId },
          select: { id: true },
        });
        if (!scale) throw new NotFoundException('Grading scale not found in this tenant');
      }

      try {
        return await tx.examSubject.create({
          data: {
            tenantId,
            examId,
            classSubjectId: dto.classSubjectId,
            examDate: dto.examDate ? new Date(dto.examDate) : undefined,
            maxMarks: dto.maxMarks,
            passingMarks: dto.passingMarks,
            weight: dto.weight,
            gradingScaleId: dto.gradingScaleId,
          },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('This subject is already part of the exam');
        }
        throw error;
      }
    });
  }

  async removeSubject(tenantId: string, examId: string, subjectId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const subject = await tx.examSubject.findFirst({
        where: { id: subjectId, examId, tenantId },
        select: {
          id: true,
          exam: { select: { _count: { select: { examRoomAssignments: true } } } },
          _count: { select: { results: true } },
        },
      });
      if (!subject) throw new NotFoundException('Exam subject not found');
      this.assertNotRoomLocked(subject.exam);
      if (subject._count.results > 0) {
        throw new ConflictException(
          'Cannot remove a subject with entered marks; delete the marks first',
        );
      }
      await tx.examSubject.delete({ where: { id: subjectId } });
      return { id: subjectId };
    });
  }

  // A teacher may enter marks for a subject when they authored the exam OR
  // they are the assigned subject teacher for this classSubject. Staff admins
  // are unrestricted. Legacy exams with no author stay author/admin-only.
  private async assertCanEnterMarks(
    tx: any,
    tenantId: string,
    examSubject: { exam: { authorId: string | null }; classSubject: { teacherId: string | null } },
    actor?: ExamActor,
  ) {
    if (!actor) return;
    if (isStaffAdmin(actor.roles)) return;
    if (actor.roles.includes('TEACHER')) {
      if (examSubject.exam.authorId && examSubject.exam.authorId === actor.userId) return;
      if (
        examSubject.classSubject.teacherId &&
        examSubject.classSubject.teacherId ===
          (
            await tx.teacher.findFirst({
              where: { tenantId, userId: actor.userId },
              select: { id: true },
            })
          )?.id
      ) {
        return;
      }
    }
    throw new ForbiddenException('You can only enter marks for subjects you teach');
  }

  async enterMarks(tenantId: string, examSubjectId: string, dto: BulkEnterMarksDto, actor?: ExamActor) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const examSubject = await tx.examSubject.findFirst({
        where: { id: examSubjectId, tenantId },
        include: {
          gradingScale: { include: { bands: true } },
          exam: {
            select: { id: true, authorId: true, status: true, examType: { select: { name: true } } },
          },
          classSubject: { select: { id: true, teacherId: true } },
        },
      });
      if (!examSubject) throw new NotFoundException('Exam subject not found');
      await this.assertCanEnterMarks(tx, tenantId, examSubject, actor);

      // Submitted marks are locked against teacher edits; only a supervisor
      // return (back to DRAFT) reopens them. Staff admins own the release,
      // so the lock does not apply to them; legacy actor-less calls predate
      // the lock and keep their behavior.
      if (actor && !isStaffAdmin(actor.roles)) {
        const existing = await tx.examResult.findMany({
          where: { examSubjectId, tenantId },
          select: { status: true },
        });
        if (existing.some((row) => row.status !== 'DRAFT')) {
          throw new ForbiddenException(
            'Marks for this subject are submitted and locked. Ask your class supervisor to return them.',
          );
        }
      }

      const results: any[] = [];
      for (const record of dto.records) {
        const percentage = examSubject.maxMarks.toNumber() > 0
          ? (record.marks / examSubject.maxMarks.toNumber()) * 100
          : 0;

        let grade: string | null = null;
        if (examSubject.gradingScale) {
          const band = examSubject.gradingScale.bands.find(
            (b) => percentage >= b.minPercent.toNumber() && percentage <= b.maxPercent.toNumber(),
          );
          if (band) grade = band.grade;
        }

        const result = await tx.examResult.upsert({
          where: {
            examSubjectId_studentId: {
              examSubjectId,
              studentId: record.studentId,
            },
          },
          create: {
            tenantId,
            examSubjectId,
            studentId: record.studentId,
            marks: record.marks,
            grade,
            remarks: record.remarks,
            submittedBy: actor?.userId,
          },
          update: {
            marks: record.marks,
            grade,
            remarks: record.remarks,
          },
        });
        results.push(result);
      }

      await this.applyReleaseRule(tx, tenantId, examSubject.exam);

      return results;
    });
  }

  /**
   * Release rule shared by every marks-entry path (staff and teacher):
   * a TEST always auto-publishes once marks are submitted (type names are
   * tenant-managed, so match loosely); anything already PUBLISHED just
   * saves corrections silently. Other types only leave DRAFT for
   * MARKS_OPEN; explicit workflow states (SCHEDULED, ONGOING, …) are
   * never overridden. Runs inside the caller's transaction.
   */
  async applyReleaseRule(
    tx: ExamTx,
    tenantId: string,
    exam: { id: string; status: string; examType: { name: string } | null },
  ) {
    const examTypeName = exam.examType?.name?.trim().toLowerCase();
    if (examTypeName === 'test' && exam.status !== 'PUBLISHED') {
      await this.publishExamTx(tx, tenantId, exam.id);
    } else if (exam.status === 'DRAFT') {
      await tx.exam.update({
        where: { id: exam.id },
        data: { status: 'MARKS_OPEN' },
      });
    }
  }

  /**
   * The release trio shared by manual publish and Test auto-publish: flip
   * the exam's DRAFT rows, mark the exam PUBLISHED, and tell the affected
   * classes to refetch. Runs inside the caller's transaction.
   */
  private async publishExamTx(tx: ExamTx, tenantId: string, examId: string) {
    await tx.examResult.updateMany({
      where: {
        tenantId,
        examSubject: { examId },
        status: 'DRAFT',
      },
      data: { status: 'PUBLISHED' },
    });

    await tx.exam.update({
      where: { id: examId },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });

    // Only classes with subjects in this exam need to refetch; every other
    // class keeps its cached results untouched.
    const subjects = await tx.examSubject.findMany({
      where: { examId, tenantId },
      select: { classSubject: { select: { classId: true } } },
    });
    for (const classId of new Set(
      subjects.map((subject) => subject.classSubject.classId),
    )) {
      await this.realtime.emitDomainEvent({
        kind: 'exam.published',
        rooms: roomsForTarget('CLASS', classId),
        payload: { examId },
      });
    }
  }

  async publishResults(tenantId: string, examId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const exam = await tx.exam.findFirst({ where: { id: examId, tenantId } });
      if (!exam) throw new NotFoundException('Exam not found');

      await this.publishExamTx(tx, tenantId, examId);

      return { published: true };
    });
  }

  /**
   * Academic release queue: every MODERATION exam with per-class,
   * per-subject submitted/total counts, so academic affairs sees exactly
   * what the supervisors handed over. Read-only.
   */
  async listModerationQueue(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (db) => {
      const exams = await db.exam.findMany({
        where: { tenantId, status: 'MODERATION' },
        select: {
          id: true,
          name: true,
          status: true,
          publishedAt: true,
          academicYearId: true,
          examType: { select: { name: true } },
          examSubjects: {
            select: {
              id: true,
              results: { select: { studentId: true, status: true } },
              classSubject: {
                select: {
                  classId: true,
                  subject: { select: { name: true } },
                  schoolClass: { select: { id: true, className: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const queue: ModerationQueueExam[] = [];
      for (const exam of exams) {
        const byClass = new Map<string, { classId: string; className: string; subjects: typeof exam.examSubjects }>();
        for (const subject of exam.examSubjects) {
          const classId = subject.classSubject.classId;
          const entry = byClass.get(classId) ?? {
            classId,
            className: subject.classSubject.schoolClass.className,
            subjects: [],
          };
          entry.subjects.push(subject);
          byClass.set(classId, entry);
        }
        const classes: ModerationQueueClass[] = [];
        for (const { classId, className, subjects } of byClass.values()) {
          const roster = await db.studentEnrollment.findMany({
            where: { tenantId, classId, academicYearId: exam.academicYearId, status: 'ACTIVE' },
            select: { studentId: true },
          });
          const rosterIds = new Set(roster.map((entry) => entry.studentId));
          classes.push({
            classId,
            className,
            subjects: subjects.map((subject) => {
              const submittedIds = new Set(
                subject.results.filter((row) => row.status === 'SUBMITTED').map((row) => row.studentId),
              );
              return {
                examSubjectId: subject.id,
                subjectName: subject.classSubject.subject.name,
                submitted: submittedIds.size,
                total: roster.length,
                allSubmitted:
                  roster.length > 0 && [...rosterIds].every((id) => submittedIds.has(id)),
              };
            }),
          });
        }
        queue.push({
          examId: exam.id,
          examName: exam.name,
          status: exam.status,
          examType: exam.examType?.name ?? null,
          publishedAt: exam.publishedAt,
          classes,
        });
      }
      return { exams: queue };
    });
  }

  // Per-subject aggregates plus an exam-wide rollup. Only marked results
  // (marks not null) feed the numbers; DRAFT rows count as entered but the
  // caller decides visibility (publish gate stays on the results endpoints).
  async getAnalytics(tenantId: string, examId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const exam = await tx.exam.findFirst({
        where: { id: examId, tenantId },
        include: {
          examSubjects: {
            include: {
              classSubject: { include: { schoolClass: true, subject: true } },
              results: { where: { marks: { not: null } } },
            },
          },
        },
      });
      if (!exam) throw new NotFoundException('Exam not found');

      const subjects = exam.examSubjects.map((s) => {
        const marks = s.results.map((r) => Number(r.marks));
        const max = s.maxMarks ? Number(s.maxMarks) : 0;
        const passing = s.passingMarks != null ? Number(s.passingMarks) : null;
        const entered = marks.length;
        const passed = passing != null ? marks.filter((m) => m >= passing).length : null;
        const sum = marks.reduce((a, m) => a + m, 0);
        return {
          examSubjectId: s.id,
          className: s.classSubject.schoolClass.className,
          subjectName: s.classSubject.subject.name,
          maxMarks: max,
          entered,
          average: entered > 0 ? sum / entered : null,
          highest: entered > 0 ? Math.max(...marks) : null,
          lowest: entered > 0 ? Math.min(...marks) : null,
          passed,
          passRate: entered > 0 && passed != null ? passed / entered : null,
        };
      });

      const allMarks = subjects.flatMap((s, i) =>
        exam.examSubjects[i].results.map((r) => Number(r.marks)),
      );
      const totalPassed = subjects.reduce((a, s) => a + (s.passed ?? 0), 0);
      const totalEntered = subjects.reduce((a, s) => a + s.entered, 0);

      return {
        examId,
        subjects,
        overall: {
          entered: totalEntered,
          average: totalEntered > 0 ? allMarks.reduce((a, m) => a + m, 0) / totalEntered : null,
          passRate: totalEntered > 0 ? totalPassed / totalEntered : null,
        },
      };
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
