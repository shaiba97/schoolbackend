import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BatchTimetableDto,
  TimetableQueryDto,
} from './dto/timetable.dto';
import { SportQueryDto } from './dto/sport-timetable.dto';
import { safeUserSelect } from '../common/safe-user.select';

/** The days a saved week has to cover. Storage keeps the full enum; the grid is built on these. */
const SCHOOL_WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'SAT'] as const;

const DAY_LABELS: Record<string, string> = {
  SUN: 'Sun',
  MON: 'Mon',
  TUE: 'Tue',
  WED: 'Wed',
  THU: 'Thu',
  FRI: 'Fri',
  SAT: 'Sat',
};

function dayName(day: string): string {
  return DAY_LABELS[day] ?? day;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

@Injectable()
export class TimetableService {
  constructor(private prisma: PrismaService) {}

  /** Timetable writing needs a year to hang entries on; prefer the flagged current year. */
  private async resolveYearId(tx: any, tenantId: string): Promise<string> {
    const current = await tx.academicYear.findFirst({
      where: { tenantId, isCurrent: true },
      select: { id: true },
    });
    if (current) return current.id;
    const fallback = await tx.academicYear.findFirst({
      where: { tenantId },
      orderBy: { startsOn: 'desc' },
      select: { id: true },
    });
    if (!fallback) {
      throw new BadRequestException('No academic year is configured — set a current year first');
    }
    return fallback.id;
  }

  private validateTimeRange(startTime: string, endTime: string): void {
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      throw new BadRequestException('Timetable end time must be after start time');
    }
  }

  private termsOverlap(left?: string | null, right?: string | null): boolean {
    return !left || !right || left === right;
  }

  /**
   * A saved week is a whole week: every school day has to be scheduled, and no
   * day may be thinner than the school minimum. Extra days (legacy data) are
   * left alone, they just are not counted towards the rule.
   */
  private assertWeekIsComplete(byDay: Map<string, unknown[]>, minimum: number, unit: string): void {
    const counts = SCHOOL_WEEK_DAYS.map((day) => {
      const rows = (byDay.get(day) ?? []) as Array<{ isBreak?: boolean }>;
      return [day, rows.filter((row) => !row.isBreak).length] as const;
    });
    if (counts.every(([, count]) => count >= minimum)) return;

    const detail = counts.map(([day, count]) => `${dayName(day)} ${count}/${minimum}`).join(', ');
    throw new BadRequestException(
      `This week is not complete (${detail} ${unit}). Every school day needs at least ${minimum} ${unit} before it can be saved.`,
    );
  }

  /** Two cells may sit in different periods, but they can never run at the same time. */
  private assertNoCellOverlap(day: string, cells: { periodNo: number; startTime: string; endTime: string }[]): void {
    const ordered = [...cells].sort((left, right) => timeToMinutes(left.startTime) - timeToMinutes(right.startTime));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (timeToMinutes(current.startTime) < timeToMinutes(previous.endTime)) {
        throw new BadRequestException(
          `Periods ${previous.periodNo} and ${current.periodNo} overlap on ${dayName(day)}.`,
        );
      }
    }
  }

  /**
   * A teacher can only be in one place. The grid writes `teacherId` straight onto
   * the row, so this checks the submitted week against every other class's stored
   * rows for the same year. Two cells of the same week on the same day are already
   * covered by `assertNoCellOverlap`, which rejects any overlap regardless of teacher.
   */
  private async assertNoTeacherClashes(
    tx: any,
    tenantId: string,
    input: {
      classId: string;
      academicYearId: string;
      termId?: string | null;
      cells: { day: string; startTime: string; endTime: string; teacherId?: string | null }[];
    },
  ): Promise<void> {
    const teaching = input.cells.filter((cell) => Boolean(cell.teacherId));
    if (teaching.length === 0) return;

    const stored = await tx.timetableEntry.findMany({
      where: {
        tenantId,
        academicYearId: input.academicYearId,
        // Rows of the class being saved are about to be replaced by this week.
        classId: { not: input.classId },
        OR: teaching.map((cell) => ({
          teacherId: cell.teacherId as string,
          dayOfWeek: cell.day as any,
          startTime: { lt: cell.endTime },
          endTime: { gt: cell.startTime },
        })),
      },
      select: { dayOfWeek: true, startTime: true, endTime: true, teacherId: true, termId: true },
    });
    const clash = stored.find((entry: any) => this.termsOverlap(entry.termId, input.termId));
    if (clash) {
      throw new ConflictException(
        `That teacher already teaches another class on ${dayName(clash.dayOfWeek)} at that time.`,
      );
    }
  }

  async findAll(tenantId: string, query: TimetableQueryDto) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      // Omitted year means the current year: same rule the wizard used client-side.
      const academicYearId = query.academicYearId ?? (await this.resolveYearId(tx, tenantId));
      return tx.timetableEntry.findMany({
        where: {
          tenantId,
          academicYearId,
          ...(query.termId ? { termId: query.termId } : {}),
          ...(query.timetableType ? { timetableType: query.timetableType } : {}),
          ...(query.examName != null ? { examName: query.examName } : {}),
        },
        include: {
          academicYear: { select: { id: true, name: true, startsOn: true, endsOn: true, isCurrent: true } },
          term: { select: { id: true, name: true, sequenceNo: true } },
          // Direct class/subject/teacher relations so rows group without extra calls.
          schoolClass: { select: { id: true, className: true } },
          subject: true,
          teacher: { include: { user: { select: safeUserSelect } } },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { periodNo: 'asc' }],
      });
    });
  }

  async findByClass(tenantId: string, classId: string, yearId?: string, timetableType?: string, examName?: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const academicYearId = yearId ?? (await this.resolveYearId(tx, tenantId));
      return this.readClass(tx, tenantId, classId, academicYearId, timetableType, examName);
    });
  }

  /**
   * Runs on an existing handle on purpose: called from inside `withTenant`,
   * where a fresh read-only connection would miss uncommitted writes.
   */
  private async readClass(
    tx: any,
    tenantId: string,
    classId: string,
    academicYearId: string,
    timetableType?: string,
    examName?: string,
  ) {
    const schoolClass = await tx.schoolClass.findFirst({
      where: { id: classId, tenantId },
      select: { id: true },
    });
    if (!schoolClass) throw new NotFoundException('Class not found');

    return tx.timetableEntry.findMany({
      where: {
        tenantId,
        classId,
        academicYearId,
        ...(timetableType ? { timetableType } : {}),
        ...(examName != null ? { examName } : {}),
      },
      include: {
        subject: true,
        teacher: { include: { user: { select: safeUserSelect } } },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { periodNo: 'asc' }],
    });
  }

  /**
   * Applies the whole visible week in one transaction. `cells` is treated as
   * the complete grid: anything missing is deleted, anything present is
   * upserted against `UNIQUE (tenantId, classId, dayOfWeek, periodNo)`, so a
   * stale row can never survive a save.
   */
  async batchSave(tenantId: string, dto: BatchTimetableDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const schoolClass = await tx.schoolClass.findFirst({
        where: { id: dto.classId, tenantId },
        select: { id: true },
      });
      if (!schoolClass) throw new NotFoundException('Class not found');

      const academicYearId = dto.academicYearId ?? (await this.resolveYearId(tx, tenantId));
      const year = await tx.academicYear.findFirst({
        where: { id: academicYearId, tenantId },
        select: { id: true },
      });
      if (!year) throw new NotFoundException('Academic year not found');

      const timetableType = dto.timetableType;
      const examName = dto.examName?.trim() ?? '';
      if (timetableType === 'EXAMINATION' && !examName) {
        throw new BadRequestException('An examination timetable needs an exam name');
      }

      if (dto.termId) {
        const term = await tx.academicTerm.findFirst({
          where: { id: dto.termId, academicYearId, tenantId },
          select: { id: true },
        });
        if (!term) throw new NotFoundException('Academic term not found for the selected year');
      }

      const seen = new Set<string>();
      const byDay = new Map<string, typeof dto.cells>();
      const assignments = new Map<string, { subjectId: string; teacherId: string }>();
      for (const cell of dto.cells) {
        this.validateTimeRange(cell.startTime, cell.endTime);
        const key = `${cell.day}:${cell.periodNo}`;
        if (seen.has(key)) {
          throw new BadRequestException(`Duplicate cell for ${dayName(cell.day)} period ${cell.periodNo}`);
        }
        seen.add(key);
        byDay.set(cell.day, [...(byDay.get(cell.day) ?? []), cell]);

        if (cell.isBreak) {
          if (cell.subjectId || cell.teacherId) {
            throw new BadRequestException('A break cannot carry a subject or teacher');
          }
          continue;
        }
        if (!cell.subjectId || !cell.teacherId) {
          throw new BadRequestException('A class needs both a subject and a teacher in every lesson cell');
        }
        assignments.set(`${cell.subjectId}:${cell.teacherId}`, {
          subjectId: cell.subjectId,
          teacherId: cell.teacherId,
        });
      }

      for (const pair of assignments.values()) {
        await this.assertAssignment(tx, tenantId, dto.classId, pair.subjectId, pair.teacherId);
      }

      // An empty payload is the one supported way to empty a week; anything else
      // has to describe a whole, schedulable week.
      if (dto.cells.length > 0) {
        this.assertWeekIsComplete(byDay, dto.periodsPerDay, 'periods');
        for (const [day, cells] of byDay) this.assertNoCellOverlap(day, cells);
        await this.assertNoTeacherClashes(tx, tenantId, {
          classId: dto.classId,
          academicYearId,
          termId: dto.termId ?? null,
          cells: dto.cells,
        });
      }

      // Scoped to the week being saved: a save must never reach into another type's, exam's, or year's week.
      const scope = { tenantId, classId: dto.classId, timetableType, examName, academicYearId };
      await tx.timetableEntry.deleteMany({ where: scope });

      if (dto.cells.length > 0) {
        const bySlot = new Map<string, (typeof dto.cells)[number]>();
        for (const cell of dto.cells) bySlot.set(`${cell.day}:${cell.periodNo}`, cell);

        await tx.timetableEntry.createMany({
          data: [...bySlot.values()].map((cell) => ({
            tenantId,
            classId: dto.classId,
            timetableType,
            examName,
            academicYearId,
            termId: dto.termId ?? null,
            dayOfWeek: cell.day as any,
            startTime: cell.startTime,
            endTime: cell.endTime,
            periodNo: cell.periodNo,
            isBreak: cell.isBreak,
            subjectId: cell.isBreak ? null : (cell.subjectId as string),
            teacherId: cell.isBreak ? null : (cell.teacherId as string),
          })),
        });
      }

      return this.readClass(tx, tenantId, dto.classId, academicYearId, timetableType, examName);
    });
  }

  /** The lesson must be taught by someone who is actually assigned to it for this class. */
  private async assertAssignment(
    tx: any,
    tenantId: string,
    classId: string,
    subjectId: string,
    teacherId: string,
  ): Promise<void> {
    const assignment = await tx.classSubject.findFirst({
      where: { tenantId, classId, subjectId, teacherId },
      select: { id: true },
    });
    if (!assignment) {
      throw new BadRequestException('Teacher is not assigned to that subject for this class');
    }
  }

  // ---- Sport -------------------------------------------------------------
  // Sport lives in its own table: it has slots rather than periods, and the
  // rules (two slots a day, never the same sport twice) don't apply to lessons.

  async findSport(tenantId: string, query: SportQueryDto) {
    return this.prisma.withTenantRead(tenantId, (tx) => this.readSport(tx, tenantId, query));
  }

  private async readSport(tx: any, tenantId: string, query: SportQueryDto) {
    return tx.sportTimetableEntry.findMany({
      where: { tenantId, ...(query.classId ? { classId: query.classId } : {}) },
      include: { schoolClass: { select: { id: true, className: true } } },
      orderBy: [{ day: 'asc' }, { slotNo: 'asc' }],
    });
  }

}
