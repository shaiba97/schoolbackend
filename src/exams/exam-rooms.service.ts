import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ExamActor } from './exams.service';
import { CreateRoomAssignmentDto, ReorderRoomStudentsDto, UpdateRoomAssignmentDto } from './dto/exam.dto';

function isStaffAdmin(roles: string[] = []): boolean {
  return roles.includes('ADMIN') || roles.includes('ACADEMIC_ADMIN');
}

@Injectable()
export class ExamRoomsService {
  constructor(private prisma: PrismaService) {}

  private assertCanEditExam(exam: { authorId?: string | null }, actor?: ExamActor) {
    if (!actor) return;
    if (isStaffAdmin(actor.roles)) return;
    if (actor.roles.includes('TEACHER') && exam.authorId && exam.authorId === actor.userId) return;
    throw new ForbiddenException('You can only manage rooms for exams you authored');
  }

  private async requireExam(tx: any, tenantId: string, examId: string, actor?: ExamActor) {
    const exam = await tx.exam.findFirst({
      where: { id: examId, tenantId },
      include: {
        examSubjects: { include: { classSubject: { select: { classId: true } } } },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    this.assertCanEditExam(exam, actor);
    return exam;
  }

  private async requireRoom(tx: any, tenantId: string, examId: string, roomId: string) {
    const room = await tx.examRoomAssignment.findFirst({
      where: { id: roomId, examId, tenantId },
    });
    if (!room) throw new NotFoundException('Room assignment not found for this exam');
    return room;
  }

  // Assign a hall to the exam. Students default to every actively-enrolled
  // student of the exam's classes, auto-seated alphabetically (seatOrder
  // 1..N); pass explicit studentIds to seat a custom set in array order.
  async assignRoom(tenantId: string, examId: string, dto: CreateRoomAssignmentDto, actor?: ExamActor) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const exam = await this.requireExam(tx, tenantId, examId, actor);

      const hall = await tx.hall.findFirst({ where: { id: dto.hallId, tenantId } });
      if (!hall) throw new NotFoundException('Hall not found in this tenant');

      const existing = await tx.examRoomAssignment.findFirst({
        where: { examId, hallId: dto.hallId, tenantId },
      });
      if (existing) throw new ConflictException('This hall is already assigned to the exam');

      for (const teacherId of dto.invigilatorIds ?? []) {
        const teacher = await tx.teacher.findFirst({ where: { id: teacherId, tenantId } });
        if (!teacher) throw new NotFoundException('Invigilating teacher not found in this tenant');
      }

      let studentIds: string[] = dto.studentIds ?? [];
      if (!dto.studentIds) {
        const classIds: string[] = Array.from(
          new Set((exam.examSubjects as any[]).map((s) => s.classSubject.classId as string)),
        );
        const enrollments = await tx.studentEnrollment.findMany({
          where: { tenantId, classId: { in: classIds }, academicYearId: exam.academicYearId, status: 'ACTIVE' },
          include: { student: true },
        });
        studentIds = (enrollments as any[])
          .map((e) => e.student)
          .sort((a, b) =>
            `${a.lastName ?? ''} ${a.firstName}`.localeCompare(`${b.lastName ?? ''} ${b.firstName}`),
          )
          .map((s) => s.id as string);
      } else {
        for (const studentId of studentIds) {
          const student = await tx.student.findFirst({ where: { id: studentId, tenantId } });
          if (!student) throw new NotFoundException('Student not found in this tenant');
        }
      }

      const room = await tx.examRoomAssignment.create({
        data: { tenantId, examId, hallId: dto.hallId },
      });

      if (dto.invigilatorIds?.length) {
        await tx.examRoomInvigilator.createMany({
          data: dto.invigilatorIds.map((teacherId) => ({
            tenantId,
            examRoomAssignmentId: room.id,
            teacherId,
          })),
        });
      }

      if (studentIds.length) {
        await tx.examRoomStudent.createMany({
          data: studentIds.map((studentId, index) => ({
            tenantId,
            examRoomAssignmentId: room.id,
            studentId,
            seatOrder: index + 1,
          })),
        });
      }

      return this.readRoom(tx, tenantId, room.id);
    });
  }

  async listRooms(tenantId: string, examId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const exam = await tx.exam.findFirst({ where: { id: examId, tenantId } });
      if (!exam) throw new NotFoundException('Exam not found');
      const rooms = await tx.examRoomAssignment.findMany({
        where: { examId, tenantId },
        include: { hall: true },
        orderBy: { createdAt: 'asc' },
      });
      return Promise.all(rooms.map((r: any) => this.readRoom(tx, tenantId, r.id)));
    });
  }

  async updateInvigilators(
    tenantId: string,
    examId: string,
    roomId: string,
    dto: UpdateRoomAssignmentDto,
    actor?: ExamActor,
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.requireExam(tx, tenantId, examId, actor);
      await this.requireRoom(tx, tenantId, examId, roomId);

      for (const teacherId of dto.invigilatorIds) {
        const teacher = await tx.teacher.findFirst({ where: { id: teacherId, tenantId } });
        if (!teacher) throw new NotFoundException('Invigilating teacher not found in this tenant');
      }

      await tx.examRoomInvigilator.deleteMany({ where: { examRoomAssignmentId: roomId, tenantId } });
      if (dto.invigilatorIds.length) {
        await tx.examRoomInvigilator.createMany({
          data: [...new Set(dto.invigilatorIds)].map((teacherId) => ({
            tenantId,
            examRoomAssignmentId: roomId,
            teacherId,
          })),
        });
      }
      return this.readRoom(tx, tenantId, roomId);
    });
  }

  // Persist a manual seating order (e.g. after drag-and-drop). Every order
  // must reference a student seated in this room; anything else is 404 so a
  // cross-room id can never silently reseat the wrong row.
  async reorderStudents(
    tenantId: string,
    examId: string,
    roomId: string,
    dto: ReorderRoomStudentsDto,
    actor?: ExamActor,
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.requireExam(tx, tenantId, examId, actor);
      await this.requireRoom(tx, tenantId, examId, roomId);

      const seated = await tx.examRoomStudent.findMany({
        where: { examRoomAssignmentId: roomId, tenantId },
      });
      const seatedByStudent = new Map(seated.map((s: any) => [s.studentId, s]));
      for (const order of dto.orders) {
        if (!seatedByStudent.has(order.studentId)) {
          throw new NotFoundException('Student is not seated in this room');
        }
      }

      for (const order of dto.orders) {
        const row = seatedByStudent.get(order.studentId);
        await tx.examRoomStudent.update({
          where: { id: row.id },
          data: { seatOrder: order.seatOrder },
        });
      }
      return this.readRoom(tx, tenantId, roomId);
    });
  }

  async removeRoom(tenantId: string, examId: string, roomId: string, actor?: ExamActor) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.requireExam(tx, tenantId, examId, actor);
      await this.requireRoom(tx, tenantId, examId, roomId);
      // Children cascade via the schema relations; removing the last room
      // naturally lifts the partial subject lock.
      await tx.examRoomAssignment.delete({ where: { id: roomId } });
      return { id: roomId };
    });
  }

  private async readRoom(tx: any, tenantId: string, roomId: string) {
    const room = await tx.examRoomAssignment.findFirst({
      where: { id: roomId, tenantId },
      include: {
        hall: true,
        invigilators: { include: { teacher: true } },
        students: {
          include: { student: true },
          orderBy: { seatOrder: 'asc' },
        },
      },
    });
    if (!room) throw new NotFoundException('Room assignment not found');
    return room;
  }
}
