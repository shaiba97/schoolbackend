import { FinancePortalService } from './finance-portal.service';

const TENANT = 'tenant-1';
const STUDENT_ID = 'student-uuid-1';

function makeScheduleTx(o: {
  structure: any | null;
  student?: any;
}) {
  const tx: any = {
    student: {
      findFirst: jest.fn(async () => o.student ?? {
        id: STUDENT_ID, firstName: 'Amina', lastName: 'Khalid',
        educationLevel: 'SECONDARY', grade: 3,
      }),
      findMany: jest.fn(async () => [{
        id: STUDENT_ID, educationLevel: 'SECONDARY', grade: 3,
      }]),
    },
    academicYear: { findFirst: jest.fn(async () => ({ id: 'year-1' })) },
    studentFeeStructure: { findMany: jest.fn(async () => []) },
    studentEnrollment: { findMany: jest.fn(async () => []) },
    paymentAllocation: { findMany: jest.fn(async () => []) },
    feeStructure: { findMany: jest.fn(async () => (o.structure ? [o.structure] : [])) },
  };
  return tx;
}

function makeService(tx: any) {
  const prisma: any = { withTenantRead: async (_t: string, cb: any) => cb(tx) };
  const noop: any = {};
  return new FinancePortalService(prisma, noop, noop, noop, noop, noop, noop, noop, noop, { emitDomainEvent: jest.fn(async () => undefined) } as any);
}

const structSecondary3 = {
  id: 'struct-sec-3',
  educationLevel: 'SECONDARY',
  grade: 'THIRD',
  registrationFee: 50000,
  tuitionFee: 400000,
  currencyCode: 'SDG',
  frequency: 'ANNUAL',
  installments: [
    { installmentNo: 1, amount: 200000, dueDate: new Date('2026-12-01T00:00:00Z') },
    { installmentNo: 2, amount: 200000, dueDate: new Date('2027-03-01T00:00:00Z') },
  ],
};

describe('getStudentSchedule — level+grade preview for unassigned students', () => {
  it('resolves the matching fee structure and returns installments with proposed:true', async () => {
    const svc = makeService(makeScheduleTx({ structure: structSecondary3 }));
    const sched: any = await svc.getStudentSchedule(TENANT, STUDENT_ID);

    expect(sched.assigned).toBe(true);
    expect(sched.proposed).toBe(true);
    expect(sched.feeStructureId).toBe('struct-sec-3');
    expect(sched.studentFeeStructureId).toBeNull();
    expect(sched.installments).toHaveLength(2);
    expect(sched.installments[0]).toMatchObject({ no: 1, amount: 200000, paid: 0 });
    expect(sched.totalFee).toBe(450000);
    expect(sched.balance).toBe(450000);
  });

  it('falls back to level-only structure when no exact grade match exists', async () => {
    const levelOnly = { ...structSecondary3, grade: null };
    const svc = makeService(makeScheduleTx({ structure: levelOnly }));
    const sched: any = await svc.getStudentSchedule(TENANT, STUDENT_ID);

    expect(sched.assigned).toBe(true);
    expect(sched.proposed).toBe(true);
  });

  it('returns assigned:false when no structure matches the student level+grade', async () => {
    const svc = makeService(makeScheduleTx({ structure: null }));
    const sched: any = await svc.getStudentSchedule(TENANT, STUDENT_ID);

    expect(sched.assigned).toBe(false);
    expect(sched.installments).toEqual([]);
  });

  it('logs a structured warning and degrades to assigned:false when structure resolution throws', async () => {
    const tx = makeScheduleTx({ structure: structSecondary3 });
    const svc: any = makeService(tx);
    jest.spyOn(svc, 'resolveStructureForStudent').mockRejectedValueOnce(new Error('db down'));
    const warnSpy = jest.spyOn(svc.logger, 'warn').mockImplementation(() => undefined);

    const sched: any = await svc.getStudentSchedule(TENANT, STUDENT_ID);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'fee_structure_resolution_failed', studentId: STUDENT_ID }),
      expect.any(String),
    );
    expect(sched.assigned).toBe(false);
    expect(sched.installments).toEqual([]);
  });
});
