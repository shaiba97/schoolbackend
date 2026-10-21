import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssignDutyDto, CreateSlotDto, SetSeatsDto, UpdateSlotDto } from './dto/scheduling.dto';

@Injectable()
export class ExamSchedulingService {
  constructor(private prisma: PrismaService) {}

  private assertTimeRange(startTime: string, endTime: string) {
    if (startTime >= endTime) {
      throw new BadRequestException('endTime must be after startTime');
    }
  }

  async listSlots(tenantId: string, examId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const exam = await tx.exam.findFirst({ where: { id: examId, tenantId }, select: { id: true } });
      if (!exam) throw new NotFoundException('Exam not found');
      return tx.examTimetableSlot.findMany({
        where: {
          tenantId,
          examSubject: { examId },
        },
        include: {
          examSubject: {
            include: {
              classSubject: {
                include: {
                  schoolClass: { select: { id: true, className: true } },
                  subject: true,
                },
              },
            },
          },
          hall: true,
          invigilationDuties: {
            include: { teacher: { include: { user: true } }, hall: true },
          },
          seatAssignments: {
            include: { student: true },
            orderBy: { seatNumber: 'asc' },
          },
          _count: { select: { seatAssignments: true } },
        },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      });
    });
  }

  async createSlot(tenantId: string, examId: string, dto: CreateSlotDto) {
    this.assertTimeRange(dto.startTime, dto.endTime);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const exam = await tx.exam.findFirst({ where: { id: examId, tenantId } });
      if (!exam) throw new NotFoundException('Exam not found');

      const subject = await tx.examSubject.findFirst({
        where: { id: dto.examSubjectId, examId, tenantId },
      });
      if (!subject) throw new NotFoundException('Exam subject not found in this exam');

      if (dto.hallId) {
        const hall = await tx.hall.findFirst({ where: { id: dto.hallId, tenantId } });
        if (!hall) throw new NotFoundException('Hall not found');
      }

      return tx.examTimetableSlot.create({
        data: {
          tenantId,
          examSubjectId: dto.examSubjectId,
          hallId: dto.hallId,
          date: new Date(dto.date),
          startTime: dto.startTime,
          endTime: dto.endTime,
        },
        include: { hall: true },
      });
    });
  }

  async updateSlot(tenantId: string, slotId: string, dto: UpdateSlotDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const slot = await tx.examTimetableSlot.findFirst({ where: { id: slotId, tenantId } });
      if (!slot) throw new NotFoundException('Timetable slot not found');

      const startTime = dto.startTime ?? slot.startTime;
      const endTime = dto.endTime ?? slot.endTime;
      this.assertTimeRange(startTime, endTime);

      if (dto.hallId !== undefined && dto.hallId !== null) {
        const hall = await tx.hall.findFirst({ where: { id: dto.hallId, tenantId } });
        if (!hall) throw new NotFoundException('Hall not found');
      }

      return tx.examTimetableSlot.update({
          where: { id_tenantId: { id: slotId, tenantId } },
        data: {
          date: dto.date ? new Date(dto.date) : undefined,
          startTime: dto.startTime,
          endTime: dto.endTime,
          hallId: dto.hallId === undefined ? undefined : dto.hallId,
        },
        include: { hall: true },
      });
    });
  }

  async deleteSlot(tenantId: string, slotId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const slot = await tx.examTimetableSlot.findFirst({
        where: { id: slotId, tenantId },
        select: { id: true },
      });
      if (!slot) throw new NotFoundException('Timetable slot not found');
      // Seats, duties, and attendance cascade-delete with the slot.
      await tx.examTimetableSlot.delete({ where: { id_tenantId: { id: slotId, tenantId } } });
      return { id: slotId };
    });
  }

  async setSeats(tenantId: string, slotId: string, dto: SetSeatsDto) {
    const studentIds = [...new Set(dto.studentIds)];
    if (studentIds.length === 0) {
      throw new BadRequestException('Select at least one student — a room with zero seats is meaningless');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const slot = await tx.examTimetableSlot.findFirst({ where: { id: slotId, tenantId } });
      if (!slot) throw new NotFoundException('Timetable slot not found');

      const hall = await tx.hall.findFirst({ where: { id: dto.hallId, tenantId } });
      if (!hall) throw new NotFoundException('Hall not found');

      const students = await tx.student.findMany({
        where: { id: { in: studentIds }, tenantId },
        select: { id: true },
      });
      const found = new Set(students.map((s) => s.id));
      const missing = studentIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(`${missing.length} student(s) not found in this tenant`);
      }

      await tx.seatAssignment.deleteMany({
        where: { examTimetableSlotId: slotId, hallId: dto.hallId, tenantId },
      });
      // Seats are numbered by position in the submitted order (1-based), which
      // also satisfies the per-hall seat uniqueness constraint and gives the
      // printable room card its seat numbers for free.
      for (const [index, studentId] of studentIds.entries()) {
        await tx.seatAssignment.create({
          data: {
            tenantId,
            examTimetableSlotId: slotId,
            hallId: dto.hallId,
            studentId,
            seatNumber: String(index + 1),
          },
        });
      }
      // Keep the slot pointed at the hall its seats live in, so seats can
      // never strand under a hall the print card no longer queries.
      if (slot.hallId !== dto.hallId) {
        await tx.examTimetableSlot.update({
          where: { id_tenantId: { id: slotId, tenantId } }, data: { hallId: dto.hallId } });
      }

      return tx.seatAssignment.findMany({
        where: { examTimetableSlotId: slotId, hallId: dto.hallId, tenantId },
        include: { student: true },
        orderBy: { seatNumber: 'asc' },
      });
    });
  }

  async listSeats(tenantId: string, slotId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const slot = await tx.examTimetableSlot.findFirst({ where: { id: slotId, tenantId } });
      if (!slot) throw new NotFoundException('Timetable slot not found');
      return tx.seatAssignment.findMany({
        where: { examTimetableSlotId: slotId, tenantId },
        include: { student: true, hall: true },
        orderBy: [{ hall: { name: 'asc' } }, { student: { firstName: 'asc' } }],
      });
    });
  }

  async assignDuty(tenantId: string, slotId: string, dto: AssignDutyDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const slot = await tx.examTimetableSlot.findFirst({ where: { id: slotId, tenantId } });
      if (!slot) throw new NotFoundException('Timetable slot not found');

      const teacher = await tx.teacher.findFirst({ where: { id: dto.teacherId, tenantId } });
      if (!teacher) throw new NotFoundException('Teacher not found');

      const hall = await tx.hall.findFirst({ where: { id: dto.hallId, tenantId } });
      if (!hall) throw new NotFoundException('Hall not found');

      try {
        return await tx.invigilationDuty.create({
          data: {
            tenantId,
            examTimetableSlotId: slotId,
            teacherId: dto.teacherId,
            hallId: dto.hallId,
          },
          include: { teacher: { include: { user: true } }, hall: true },
        });
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          throw new ConflictException('This teacher already has a duty in this session');
        }
        throw error;
      }
    });
  }

  async removeDuty(tenantId: string, dutyId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const duty = await tx.invigilationDuty.findFirst({ where: { id: dutyId, tenantId } });
      if (!duty) throw new NotFoundException('Invigilation duty not found');
      await tx.invigilationDuty.delete({ where: { id_tenantId: { id: dutyId, tenantId } } });
      return { id: dutyId };
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
