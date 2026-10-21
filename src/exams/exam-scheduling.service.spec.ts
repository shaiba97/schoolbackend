import { ExamSchedulingService } from './exam-scheduling.service';
import type { PrismaService } from '../prisma/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';

function mockPrisma(tx: Record<string, unknown>) {
  return {
    withTenant: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    withTenantRead: jest.fn(async (_tenant: string, callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
}

describe('ExamSchedulingService', () => {
  it('rejects a slot whose end is not after its start without touching the database', async () => {
    const tx = { examTimetableSlot: { create: jest.fn() } };
    const service = new ExamSchedulingService(mockPrisma(tx));

    await expect(
      service.createSlot(tenantId, 'exam-1', {
        examSubjectId: 'subject-1',
        date: '2026-10-01',
        startTime: '10:00',
        endTime: '09:00',
      }),
    ).rejects.toThrow('endTime must be after startTime');
    expect(tx.examTimetableSlot.create).not.toHaveBeenCalled();
  });

  it('replaces the seat set for a slot and hall', async () => {
    const created: Array<Record<string, unknown>> = [];
    const tx = {
      examTimetableSlot: {
        findFirst: jest.fn().mockResolvedValue({ id: 'slot-1', hallId: 'hall-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      hall: { findFirst: jest.fn().mockResolvedValue({ id: 'hall-1' }) },
      student: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]) },
      seatAssignment: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { ...data };
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new ExamSchedulingService(mockPrisma(tx));

    await service.setSeats(tenantId, 'slot-1', { hallId: 'hall-1', studentIds: ['s1', 's2'] });

    expect(tx.seatAssignment.deleteMany).toHaveBeenCalledWith({
      where: { examTimetableSlotId: 'slot-1', hallId: 'hall-1', tenantId },
    });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ studentId: 's1', seatNumber: '1' });
    expect(created[1]).toMatchObject({ studentId: 's2', seatNumber: '2' });
  });

  it('syncs the slot hall when seats are set for a different hall', async () => {
    const tx = {
      examTimetableSlot: {
        findFirst: jest.fn().mockResolvedValue({ id: 'slot-1', hallId: 'hall-old' }),
        update: jest.fn().mockResolvedValue({}),
      },
      hall: { findFirst: jest.fn().mockResolvedValue({ id: 'hall-new' }) },
      student: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }]) },
      seatAssignment: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new ExamSchedulingService(mockPrisma(tx));

    await service.setSeats(tenantId, 'slot-1', { hallId: 'hall-new', studentIds: ['s1'] });

    expect(tx.examTimetableSlot.update).toHaveBeenCalledWith({
      where: { id_tenantId: { id: 'slot-1', tenantId } },
      data: { hallId: 'hall-new' },
    });
  });

  it('rejects unknown students when setting seats', async () => {    const tx = {
      examTimetableSlot: { findFirst: jest.fn().mockResolvedValue({ id: 'slot-1' }) },
      hall: { findFirst: jest.fn().mockResolvedValue({ id: 'hall-1' }) },
      student: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }]) },
      seatAssignment: { deleteMany: jest.fn(), create: jest.fn() },
    };
    const service = new ExamSchedulingService(mockPrisma(tx));

    await expect(
      service.setSeats(tenantId, 'slot-1', { hallId: 'hall-1', studentIds: ['s1', 'ghost'] }),
    ).rejects.toThrow('1 student(s) not found in this tenant');
    expect(tx.seatAssignment.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a duplicate duty for the same teacher and session with 409', async () => {
    const err = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const tx = {
      examTimetableSlot: { findFirst: jest.fn().mockResolvedValue({ id: 'slot-1' }) },
      teacher: { findFirst: jest.fn().mockResolvedValue({ id: 't1' }) },
      hall: { findFirst: jest.fn().mockResolvedValue({ id: 'hall-1' }) },
      invigilationDuty: { create: jest.fn().mockRejectedValue(err) },
    };
    const service = new ExamSchedulingService(mockPrisma(tx));

    await expect(
      service.assignDuty(tenantId, 'slot-1', { teacherId: 't1', hallId: 'hall-1' }),
    ).rejects.toThrow('This teacher already has a duty in this session');
  });

  it('lists slots without opening a transaction', async () => {
    const rows = [{ id: 'slot-1' }];
    const tx = {
      exam: { findFirst: jest.fn().mockResolvedValue({ id: 'exam-1' }) },
      examTimetableSlot: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const prisma = mockPrisma(tx);
    const service = new ExamSchedulingService(prisma);

    await expect(service.listSlots(tenantId, 'exam-1')).resolves.toBe(rows);
    expect(prisma.withTenantRead).toHaveBeenCalled();
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });
});
