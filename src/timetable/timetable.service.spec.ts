import { TimetableService } from './timetable.service';
import type { PrismaService } from '../prisma/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const yearId = '22222222-2222-4222-8222-222222222222';
const termId = '33333333-3333-4333-8333-333333333333';
const classId = '44444444-4444-4444-8444-444444444444';
const subjectId = '55555555-5555-4555-8555-555555555555';

const SCHOOL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'SAT'] as const;

function periodBand(slot: number) {
  const start = 7 * 60 + (slot - 1) * 50;
  const label = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { startTime: label(start), endTime: label(start + 50) };
}

function lessonCell(day: string, slot: number) {
  return {
    day,
    periodNo: slot,
    isBreak: false,
    subjectId,
    teacherId: `teacher-${slot}`,
    ...periodBand(slot),
  };
}

/** A schedulable week: seven non-overlapping periods on each school day. */
function completeWeek() {
  return SCHOOL_DAYS.flatMap((day) => [1, 2, 3, 4, 5, 6, 7].map((slot) => lessonCell(day, slot)));
}

function createHarness(options: { storedEntries?: unknown[] } = {}) {
  const tx = {
    schoolClass: { findFirst: jest.fn().mockResolvedValue({ id: classId }) },
    academicYear: { findFirst: jest.fn().mockResolvedValue({ id: yearId }) },
    classSubject: { findFirst: jest.fn().mockResolvedValue({ id: 'assignment-1' }) },
    timetableEntry: {
      findMany: jest.fn().mockResolvedValue(options.storedEntries ?? []),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    sportTimetableEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    withTenant: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    withTenantRead: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
  return { service: new TimetableService(prisma), tx };
}

describe('TimetableService.findAll', () => {
  it('reads entries for the selected academic year and term', async () => {
    const entries = [{ id: 'entry-1' }];
    const tx = {
      timetableEntry: {
        findMany: jest.fn().mockResolvedValue(entries),
      },
    };
    const prisma = {
      withTenant: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      withTenantRead: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const service = new TimetableService(prisma);

    const result = await service.findAll(tenantId, { academicYearId: yearId, termId });

    expect(result).toBe(entries);
    expect(tx.timetableEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId, academicYearId: yearId, termId }),
    }));
    const include = tx.timetableEntry.findMany.mock.calls[0][0].include;
    expect(include).toEqual(expect.objectContaining({
      schoolClass: { select: { id: true, className: true } },
      subject: true,
      teacher: expect.objectContaining({ include: expect.anything() }),
    }));
    expect(include).not.toHaveProperty('sectionSubject');
  });

  it('resolves the current year when academicYearId is omitted', async () => {
    const entries = [{ id: 'entry-1' }];
    const tx = {
      academicYear: {
        findFirst: jest.fn().mockResolvedValue({ id: yearId }),
      },
      timetableEntry: {
        findMany: jest.fn().mockResolvedValue(entries),
      },
    };
    const prisma = {
      withTenant: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
      withTenantRead: jest.fn(async (_tenant: string, callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const service = new TimetableService(prisma);

    const result = await service.findAll(tenantId, {});

    expect(result).toBe(entries);
    expect(tx.timetableEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId, academicYearId: yearId }),
    }));
  });
});

describe('TimetableService.batchSave', () => {
  it('saves a complete week and prunes only inside the saved year', async () => {
    const { service, tx } = createHarness();

    await service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REGULAR', periodsPerDay: 7, cells: completeWeek() });

    expect(tx.timetableEntry.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ tenantId, classId, academicYearId: yearId })]),
    });
    expect(tx.timetableEntry.createMany.mock.calls[0][0].data).toHaveLength(SCHOOL_DAYS.length * 7);
    expect(tx.timetableEntry.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantId, classId, academicYearId: yearId }),
    });
  });

  it('checks each subject/teacher assignment once, not once per cell', async () => {
    const { service, tx } = createHarness();
    const cells = completeWeek();

    await service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REGULAR', periodsPerDay: 7, cells });

    const distinctPairs = new Set(cells.map((cell) => `${cell.subjectId}:${cell.teacherId}`));
    expect(distinctPairs.size).toBeLessThan(cells.length);
    expect(tx.classSubject.findFirst).toHaveBeenCalledTimes(distinctPairs.size);
  });

  it('rejects a week that leaves a school day unscheduled', async () => {
    const { service, tx } = createHarness();
    const cells = completeWeek().filter((cell) => cell.day !== 'SAT');

    await expect(service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REGULAR', periodsPerDay: 1, cells })).rejects.toThrow(/not complete/);
    expect(tx.timetableEntry.createMany).not.toHaveBeenCalled();
  });

  it('rejects a school day that is under the minimum periods', async () => {
    const { service } = createHarness();
    const cells = completeWeek().filter((cell) => cell.day !== 'WED');

    await expect(service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REGULAR', periodsPerDay: 1, cells })).rejects.toThrow(/Wed 0\/1/);
  });

  it('rejects two cells that run at the same time on one day', async () => {
    const { service } = createHarness();
    const cells = completeWeek();
    const third = cells.find((cell) => cell.day === 'MON' && cell.periodNo === 3)!;
    third.startTime = '08:30';
    third.endTime = '09:20';

    await expect(service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REGULAR', periodsPerDay: 7, cells })).rejects.toThrow(/overlap on Mon/);
  });

  it('rejects a teacher who already teaches another class at that time', async () => {
    const { service, tx } = createHarness({
      storedEntries: [{ dayOfWeek: 'MON', startTime: '07:00', endTime: '07:50', teacherId: 'teacher-1', termId: null }],
    });

    await expect(service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REGULAR', periodsPerDay: 7, cells: completeWeek() }))
      .rejects.toThrow(/already teaches another class/);
    // The class being saved is excluded: its own rows are about to be replaced.
    expect(tx.timetableEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ classId: { not: classId } }),
    }));
  });

  it('allows a teacher to hold back-to-back periods in the same week', async () => {
    const { service } = createHarness();
    const cells = completeWeek();
    const monday = cells.filter((cell) => cell.day === 'MON');
    monday.forEach((cell) => {
      cell.teacherId = 'teacher-1';
    });

    await expect(service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REGULAR', periodsPerDay: 7, cells })).resolves.toEqual([]);
    expect(monday).toHaveLength(7);
  });

  it('scopes the cross-class conflict query to each cell own teacher', async () => {
    const { service, tx } = createHarness();
    const cells = completeWeek();
    cells.filter((cell) => cell.day === 'SAT').forEach((cell) => {
      cell.teacherId = 'teacher-2';
    });

    await expect(service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REGULAR', periodsPerDay: 7, cells })).resolves.toEqual([]);

    const crossClass = tx.timetableEntry.findMany.mock.calls
      .map(([args]) => args.where)
      .find((where) => where.classId?.not);
    expect(crossClass.teacherId).toBeUndefined();
    expect(crossClass.OR.every((branch: any) => typeof branch.teacherId === 'string')).toBe(true);
    expect(crossClass.OR.filter((branch: any) => branch.dayOfWeek === 'SAT').map((b: any) => b.teacherId))
      .toEqual(Array(7).fill('teacher-2'));
  });

  it('treats an empty payload as an explicit clear of the saved year', async () => {
    const { service, tx } = createHarness();

    await service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REGULAR', periodsPerDay: 1, cells: [] });

    expect(tx.timetableEntry.deleteMany).toHaveBeenCalledWith({ where: { tenantId, classId, timetableType: 'REGULAR', examName: '', academicYearId: yearId } });
    expect(tx.timetableEntry.createMany).not.toHaveBeenCalled();
  });

  it('scopes a save to its timetable type so other weeks survive', async () => {
    const { service, tx } = createHarness();

    await service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REVISION', periodsPerDay: 7, cells: completeWeek() });

    expect(tx.timetableEntry.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantId, classId, timetableType: 'REVISION', examName: '' }),
    });
    expect(tx.timetableEntry.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ timetableType: 'REVISION', examName: '' })]),
    });
  });

  it('requires an exam name for examination weeks', async () => {
    const { service } = createHarness();

    await expect(
      service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'EXAMINATION', periodsPerDay: 7, cells: completeWeek() }),
    ).rejects.toThrow(/needs an exam name/);
  });

  it('stores examination weeks under their exam name', async () => {
    const { service, tx } = createHarness();

    await service.batchSave(tenantId, {
      classId,
      academicYearId: yearId,
      timetableType: 'EXAMINATION',
      examName: 'Midterm',
      periodsPerDay: 7,
      cells: completeWeek(),
    });

    expect(tx.timetableEntry.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ timetableType: 'EXAMINATION', examName: 'Midterm' }),
    });
    expect(tx.timetableEntry.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ timetableType: 'EXAMINATION', examName: 'Midterm' })]),
    });
  });

  it('enforces the requested periods-per-day minimum', async () => {
    const { service } = createHarness();
    const cells = completeWeek().filter((cell) => !(cell.day === 'WED' && cell.periodNo > 2));

    await expect(
      service.batchSave(tenantId, { classId, academicYearId: yearId, timetableType: 'REGULAR', periodsPerDay: 3, cells }),
    ).rejects.toThrow(/Wed 2\/3/);
  });
});

