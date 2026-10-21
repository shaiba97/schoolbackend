import { FinancePortalService } from './finance-portal.service';

const TENANT = 'tenant-1';
const STUDENT_ID = 'student-1';
const LINK_ID = 'link-1';

// Two-installment plan: fi1 = 2,000,000, fi2 = 2,000,000, totalFee = 4,000,000.
function makeTx(o: {
  existingAllocs?: any[];
  eligibilities?: any[];
  priorDiscounts?: any[];
  totalFee?: number;
  installments?: { installmentNo: number; amount: number }[];
}) {
  const applied: any[] = [...(o.priorDiscounts ?? [])];
  const eligStore = [...(o.eligibilities ?? [])];
  const installments = o.installments ?? [
    { installmentNo: 1, amount: 2000000 },
    { installmentNo: 2, amount: 2000000 },
  ];
  const tx: any = {
    academicYear: { findFirst: jest.fn(async () => ({ id: 'year-1' })) },
    student: { findFirst: jest.fn(async () => ({ id: STUDENT_ID, educationLevel: 'SECONDARY', grade: 1 })) },
    studentFeeStructure: {
      findFirst: jest.fn(async () => ({
        id: LINK_ID,
        totalFee: o.totalFee ?? 4000000,
        feeStructure: {
          id: 'struct-1',
          registrationFee: 0,
          tuitionFee: o.totalFee ?? 4000000,
          installments: installments.map((i, ix) => ({ id: `fi-${ix}`, ...i })),
        },
      })),
    },
    tenant: { findUnique: jest.fn(async () => ({ currencyCode: 'SDG' })) },
    paymentAllocation: { findMany: jest.fn(async () => o.existingAllocs ?? []) },
    payment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'pay-new', ...data })),
    },
    discountEligibility: {
      findMany: jest.fn(async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return eligStore.filter((e) => ids.includes(e.id));
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = eligStore.find((e) => e.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    discountApplication: {
      findMany: jest.fn(async () => applied),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `da-${applied.length + 1}`, tenantId: TENANT, ...data };
        applied.push(row);
        return row;
      }),
    },
  };
  return { tx, applied, eligStore };
}

function makeService(tx: any) {
  const prisma: any = { withTenant: async (_t: string, cb: any) => cb(tx) };
  const noop: any = {};
  return new FinancePortalService(prisma, noop, noop, noop, noop, noop, noop, noop, noop, { emitDomainEvent: jest.fn(async () => undefined) } as any);
}

const pct = (id: string, value: number, extra: any = {}) => ({
  id,
  tenantId: TENANT,
  studentId: STUDENT_ID,
  sourceType: 'SIBLING',
  sourceRefId: 'sd-1',
  valueType: 'PERCENTAGE',
  value,
  label: `Sibling Discount (${value}%)`,
  academicYearId: null,
  expiresAt: null,
  appliedAmount: 0,
  appliedAt: null,
  ...extra,
});

const alloc = (installmentNo: number, amount: number) => ({ installmentNo, kind: 'installment', amount });

describe('recordPayment with discountIds', () => {
  it('applies a 15% sibling discount (600k of 4M) to the earliest installment', async () => {
    const { tx, applied, eligStore } = makeTx({ eligibilities: [pct('elig-1', 15)] });
    const svc = makeService(tx);
    const res: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID,
      allocations: [alloc(1, 1400000)],
      method: 'cash',
      discountIds: ['elig-1'],
    });
    expect(res.totalDiscount).toBe(600000);
    expect(res.discounts).toEqual([
      { eligibilityId: 'elig-1', label: 'Sibling Discount (15%)', amount: 600000 },
    ]);
    expect(applied).toHaveLength(1);
    expect(applied[0].installmentNo).toBe(1);
    expect(Number(eligStore[0].appliedAmount)).toBe(600000);
  });

  it('rejects a payment that over-allocates a discounted installment', async () => {
    const { tx } = makeTx({ eligibilities: [pct('elig-1', 15)] });
    const svc = makeService(tx);
    // fi1 capacity after 600k discount = 1.4M; paying 2M must fail loudly.
    await expect(
      svc.recordPayment(TENANT, {
        studentId: STUDENT_ID,
        allocations: [alloc(1, 2000000)],
        method: 'cash',
        discountIds: ['elig-1'],
      }),
    ).rejects.toThrow('exceeds the outstanding');
  });

  it('rejects unknown discount ids', async () => {
    const { tx } = makeTx({ eligibilities: [] });
    const svc = makeService(tx);
    await expect(
      svc.recordPayment(TENANT, {
        studentId: STUDENT_ID,
        allocations: [alloc(1, 1000000)],
        method: 'cash',
        discountIds: ['nope'],
      }),
    ).rejects.toThrow('Unknown or stale discount');
  });

  it('rejects expired and fully-consumed discounts', async () => {
    const expired = pct('elig-x', 10, { expiresAt: new Date('2020-01-01T00:00:00Z') });
    const consumed = { ...pct('elig-c', 0), valueType: 'FIXED_AMOUNT', value: 100, appliedAmount: 100 };
    const { tx } = makeTx({ eligibilities: [expired, consumed] });
    const svc = makeService(tx);
    await expect(
      svc.recordPayment(TENANT, {
        studentId: STUDENT_ID, allocations: [alloc(1, 100)], method: 'cash', discountIds: ['elig-x'],
      }),
    ).rejects.toThrow('expired');
    await expect(
      svc.recordPayment(TENANT, {
        studentId: STUDENT_ID, allocations: [alloc(1, 100)], method: 'cash', discountIds: ['elig-c'],
      }),
    ).rejects.toThrow('fully applied');
  });

  it('consumes a FIXED discount once across two payments', async () => {
    const fixed = { ...pct('elig-f', 0), valueType: 'FIXED_AMOUNT', value: 500000, label: 'Family condition' };
    const { tx, eligStore } = makeTx({ eligibilities: [fixed] });
    const svc = makeService(tx);
    const first: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID, allocations: [alloc(1, 1500000)], method: 'cash', discountIds: ['elig-f'],
    });
    expect(first.totalDiscount).toBe(500000);
    await expect(
      svc.recordPayment(TENANT, {
        studentId: STUDENT_ID, allocations: [alloc(2, 100)], method: 'cash', discountIds: ['elig-f'],
      }),
    ).rejects.toThrow('fully applied');
    expect(Number(eligStore[0].appliedAmount)).toBe(500000);
  });

  it('records no applications when discountIds is omitted (legacy path)', async () => {
    const { tx, applied } = makeTx({ eligibilities: [pct('elig-1', 15)] });
    const svc = makeService(tx);
    const res: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID, allocations: [alloc(1, 2000000)], method: 'cash',
    });
    expect(res.totalDiscount).toBe(0);
    expect(res.discounts).toEqual([]);
    expect(applied).toHaveLength(0);
  });
});

describe('recordPaymentAllOutstanding with discountIds', () => {  it('subtracts the discount from the computed payable', async () => {
    const { tx, applied } = makeTx({ eligibilities: [pct('elig-1', 10)] });
    const svc = makeService(tx);
    const res: any = await svc.recordPaymentAllOutstanding(TENANT, {
      studentId: STUDENT_ID, method: 'cash', discountIds: ['elig-1'],
    });
    // 4M - 400k = 3.6M collected
    expect(res.amount).toBe(3600000);
    expect(res.totalDiscount).toBe(400000);
    expect(applied).toHaveLength(1);
  });

  it('records discount-only settlement with no payment when discounts cover everything', async () => {
    const full = { ...pct('elig-f', 0), valueType: 'FIXED_AMOUNT', value: 4000000, label: 'Family condition' };
    const { tx, applied } = makeTx({ eligibilities: [full] });
    const svc = makeService(tx);
    const res: any = await svc.recordPaymentAllOutstanding(TENANT, {
      studentId: STUDENT_ID, method: 'cash', discountIds: ['elig-f'],
    });
    expect(res.amount).toBe(0);
    expect(res.totalDiscount).toBe(4000000);
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(applied).toHaveLength(2);
    expect(applied.every((a: any) => a.paymentId === null)).toBe(true);
  });
});

describe('getStudentSchedule with applied discounts', () => {
  function scheduleTx() {
    const link = {
      id: LINK_ID,
      studentId: STUDENT_ID,
      feeStructureId: 'struct-1',
      totalFee: 4000000,
      feeStructure: {
        id: 'struct-1',
        registrationFee: 0,
        tuitionFee: 4000000,
        frequency: 'ANNUAL',
        installments: [
          { id: 'fi-0', installmentNo: 1, amount: 2000000, dueDate: new Date('2027-06-01T00:00:00Z') },
          { id: 'fi-1', installmentNo: 2, amount: 2000000, dueDate: new Date('2027-06-01T00:00:00Z') },
        ],
      },
      schoolClass: null,
    };
    const tx: any = {
      academicYear: { findFirst: jest.fn(async () => ({ id: 'year-1' })) },
      studentFeeStructure: { findMany: jest.fn(async () => [link]) },
      studentEnrollment: { findMany: jest.fn(async () => []) },
      student: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => ({ id: STUDENT_ID, firstName: 'A', lastName: 'B', educationLevel: 'SECONDARY', grade: 1 })),
      },
      paymentAllocation: {
        findMany: jest.fn(async () => [
          { studentFeeStructureId: LINK_ID, kind: 'INSTALLMENT', installmentNo: 1, amount: 1400000, payment: { status: 'COMPLETED' } },
        ]),
      },
      discountApplication: {
        findMany: jest.fn(async () => [
          { studentFeeStructureId: LINK_ID, targetKind: 'INSTALLMENT', installmentNo: 1, amount: 600000 },
        ]),
      },
    };
    return tx;
  }

  function scheduleService(tx: any) {
    const prisma: any = { withTenantRead: async (_t: string, cb: any) => cb(tx) };
    const noop: any = {};
    return new FinancePortalService(prisma, noop, noop, noop, noop, noop, noop, noop, noop, { emitDomainEvent: jest.fn(async () => undefined) } as any);
  }

  it('subtracts discounts from the balance and marks the settled installment complete', async () => {
    const svc = scheduleService(scheduleTx());
    const sched: any = await svc.getStudentSchedule(TENANT, STUDENT_ID);
    // 4M - 1.4M cash - 0.6M discount = 2M
    expect(sched.balance).toBe(2000000);
    expect(sched.totalPaid).toBe(1400000);
    expect(sched.totalDiscounted).toBe(600000);
    const fi1 = sched.installments.find((i: any) => i.no === 1);
    expect(fi1.complete).toBe(true);
    expect(fi1.discounted).toBe(600000);
    // fi1 is settled (cash + discount); the current target fi2 is untouched,
    // so the pre-existing status rule reports on_track.
    expect(sched.status).toBe('on_track');
  });
});
