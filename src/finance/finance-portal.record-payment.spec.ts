import { BadRequestException } from '@nestjs/common';
import { FinancePortalService } from './finance-portal.service';

const TENANT = 'tenant-1';
const STUDENT_ID = 'student-1';
const LINK_ID = 'link-1';

// Installment 1 = 2,000,000 of a 4,000,000 two-installment plan.
function makeTx(existingAllocs: any[] = []) {
  const tx: any = {
    academicYear: { findFirst: jest.fn(async () => ({ id: 'year-1' })) },
    student: { findFirst: jest.fn(async () => ({ id: STUDENT_ID, educationLevel: 'SECONDARY', grade: 1 })) },
    studentFeeStructure: {
      findFirst: jest.fn(async () => ({
        id: LINK_ID,
        feeStructure: {
          id: 'struct-1',
          registrationFee: 0,
          tuitionFee: 4000000,
          installments: [
            { id: 'fi-1', installmentNo: 1, amount: 2000000 },
            { id: 'fi-2', installmentNo: 2, amount: 2000000 },
          ],
        },
      })),
    },
    tenant: { findUnique: jest.fn(async () => ({ currencyCode: 'SDG' })) },
    paymentAllocation: { findMany: jest.fn(async () => existingAllocs) },
    payment: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'pay-new',
        method: data.method,
        ...data,
      })),
    },
  };
  return tx;
}

function makeService(tx: any) {
  const prisma: any = { withTenant: async (_t: string, cb: any) => cb(tx) };
  const noop: any = {};
  const realtime: any = { emitDomainEvent: jest.fn(async () => undefined) };
  return new FinancePortalService(prisma, noop, noop, noop, noop, noop, noop, noop, noop, realtime);
}

function makeEmittingService(tx: any) {
  const prisma: any = { withTenant: async (_t: string, cb: any) => cb(tx) };
  const noop: any = {};
  const realtime: any = { emitDomainEvent: jest.fn(async () => undefined) };
  const svc: any = new FinancePortalService(prisma, noop, noop, noop, noop, noop, noop, noop, noop, realtime);
  return { svc, realtime };
}

const alloc = (installmentNo: number, amount: number) => ({ installmentNo, kind: 'INSTALLMENT', amount });

function makeLedgerTx(o: {
  payments: any[];
  linkTotalFee?: number;
  installments?: { installmentNo: number; amount: number }[];
  schedAllocs?: any[];
}) {
  const link = {
    id: LINK_ID,
    studentId: STUDENT_ID,
    feeStructureId: 'struct-1',
    feeStructure: {
      id: 'struct-1',
      registrationFee: 0,
      tuitionFee: o.linkTotalFee ?? 4000000,
      frequency: 'ANNUAL',
      installments: (o.installments ?? [
        { installmentNo: 1, amount: 2000000 },
        { installmentNo: 2, amount: 2000000 },
      ]).map((i, ix) => ({ id: `fi-${ix}`, dueDate: new Date('2026-12-01T00:00:00Z'), ...i })),
    },
    schoolClass: null,
  };
  const tx: any = {
    payment: { findMany: jest.fn(async () => o.payments) },
    academicYear: { findFirst: jest.fn(async () => ({ id: 'year-1' })) },
    studentFeeStructure: { findMany: jest.fn(async () => [link]) },
    studentEnrollment: { findMany: jest.fn(async () => []) },
    paymentAllocation: { findMany: jest.fn(async () => o.schedAllocs ?? []) },
  };
  return tx;
}

function makeLedgerService(tx: any) {
  const prisma: any = {
    withTenant: async (_t: string, cb: any) => cb(tx),
    withTenantRead: async (_t: string, cb: any) => cb(tx),
  };
  const noop: any = {};
  const realtime: any = { emitDomainEvent: jest.fn(async () => undefined) };
  return new FinancePortalService(prisma, noop, noop, noop, noop, noop, noop, noop, noop, realtime);
}

const payRow = (id: string, amount: number, allocations: any[]) => ({
  id,
  studentId: STUDENT_ID,
  amount,
  currencyCode: 'SDG',
  method: 'CASH',
  paymentReference: null,
  status: 'COMPLETED',
  paidAt: new Date('2026-10-01T10:00:00Z'),
  createdAt: new Date('2026-10-01T10:00:00Z'),
  student: { id: STUDENT_ID, firstName: 'Amina', lastName: 'Khalid', educationLevel: 'SECONDARY', grade: 1 },
  allocations,
});

const schedAlloc = (paymentId: string, installmentNo: number | null, kind: string, amount: number, createdAt: string) => ({
  installmentNo,
  kind,
  amount,
  studentFeeStructureId: LINK_ID,
  paymentId,
  createdAt: new Date(createdAt),
  payment: { status: 'COMPLETED' },
});

describe('listPayments — labels and per-payment effect (Tasks 3+5)', () => {
  it("labels a partial lump-sum 'Lump-Sum (Partial)', not '(Full Year)'", async () => {
    const allocs = [
      { ...schedAlloc('pay-1', null, 'LUMP_SUM', 1500000, '2026-10-01T10:00:00Z'), createdAt: new Date('2026-10-01T10:00:00Z') },
    ];
    const svc = makeLedgerService(makeLedgerTx({
      payments: [payRow('pay-1', 1500000, [{ kind: 'LUMP_SUM', installmentNo: null, amount: 1500000, createdAt: new Date('2026-10-01T10:00:00Z') }])],
      schedAllocs: allocs,
    }));
    const rows: any[] = await svc.listPayments(TENANT);
    expect(rows[0].allocationTarget).toBe('Lump-Sum (Partial)');
    expect(rows[0].amount).toBe(1500000);
  });

  it("labels a settling lump-sum 'Lump-Sum (Full Year)'", async () => {
    const svc = makeLedgerService(makeLedgerTx({
      payments: [payRow('pay-1', 4000000, [{ kind: 'LUMP_SUM', installmentNo: null, amount: 4000000, createdAt: new Date('2026-10-01T10:00:00Z') }])],
      schedAllocs: [schedAlloc('pay-1', null, 'LUMP_SUM', 4000000, '2026-10-01T10:00:00Z')],
    }));
    const rows: any[] = await svc.listPayments(TENANT);
    expect(rows[0].allocationTarget).toBe('Lump-Sum (Full Year)');
  });

  it('reports opening vs final effect for sequential installment payments', async () => {
    const svc = makeLedgerService(makeLedgerTx({
      payments: [
        payRow('pay-2', 500000, [{ kind: 'INSTALLMENT', installmentNo: 1, amount: 500000, createdAt: new Date('2026-10-02T10:00:00Z') }]),
        payRow('pay-1', 1500000, [{ kind: 'INSTALLMENT', installmentNo: 1, amount: 1500000, createdAt: new Date('2026-10-01T10:00:00Z') }]),
      ],
      schedAllocs: [
        schedAlloc('pay-1', 1, 'INSTALLMENT', 1500000, '2026-10-01T10:00:00Z'),
        schedAlloc('pay-2', 1, 'INSTALLMENT', 500000, '2026-10-02T10:00:00Z'),
      ],
    }));
    const rows: any[] = await svc.listPayments(TENANT);
    const first = rows.find((r) => r.id === 'pay-1');
    const second = rows.find((r) => r.id === 'pay-2');
    expect(first.installmentEffect).toMatchObject({
      contributed: 1500000, amountBefore: 0, amountAfter: 1500000, isOpening: true, isFinal: false,
    });
    expect(second.installmentEffect).toMatchObject({
      contributed: 500000, amountBefore: 1500000, amountAfter: 2000000, isOpening: false, isFinal: true,
    });
    expect(second.isFinalPaymentOnInstallment).toBe(true);
  });
});

describe('recordPayment — over-allocation guard (Task 4)', () => {
  it('rejects an installment allocation exceeding the installment outstanding', async () => {
    const svc = makeService(makeTx());
    await expect(
      svc.recordPayment(TENANT, {
        studentId: STUDENT_ID,
        allocations: [alloc(1, 2500000)],
        method: 'cash',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts an allocation that exactly settles the installment', async () => {
    const tx = makeTx();
    const svc = makeService(tx);
    const res: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID,
      allocations: [alloc(1, 2000000)],
      method: 'cash',
    });
    expect(res.amount).toBe(2000000);
    expect(tx.payment.create).toHaveBeenCalled();
  });

  it('accounts for prior partial payments when checking the remainder', async () => {
    // 1,500,000 already paid against installment 1 → only 500,000 remains.
    const prior = [
      { installmentNo: 1, kind: 'INSTALLMENT', amount: 1500000, payment: { status: 'COMPLETED' } },
    ];
    const svc = makeService(makeTx(prior));
    await expect(
      svc.recordPayment(TENANT, {
        studentId: STUDENT_ID,
        allocations: [alloc(1, 600000)],
        method: 'cash',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the exact remaining balance after a partial payment', async () => {
    const prior = [
      { installmentNo: 1, kind: 'INSTALLMENT', amount: 1500000, payment: { status: 'COMPLETED' } },
    ];
    const svc = makeService(makeTx(prior));
    const res: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID,
      allocations: [alloc(1, 500000)],
      method: 'cash',
    });
    expect(res.amount).toBe(500000);
  });

  it('recordPaymentAllOutstanding settles registration + every open installment in one payment', async () => {
    const prior = [
      { installmentNo: 1, kind: 'INSTALLMENT', amount: 1500000, payment: { status: 'COMPLETED' } },
    ];
    const tx = makeTx(prior);
    // Registration fee must exist on the structure for this case.
    tx.studentFeeStructure.findFirst.mockResolvedValueOnce({
      id: LINK_ID,
      feeStructure: {
        id: 'struct-1',
        registrationFee: 200000,
        tuitionFee: 4000000,
        installments: [
          { id: 'fi-1', installmentNo: 1, amount: 2000000 },
          { id: 'fi-2', installmentNo: 2, amount: 2000000 },
        ],
      },
    });
    const svc = makeService(tx);
    const res: any = await svc.recordPaymentAllOutstanding(TENANT, {
      studentId: STUDENT_ID,
      method: 'bankak',
      transactionId: 'REF-1',
    });
    // 200,000 registration + 500,000 remainder of #1 + 2,000,000 of #2.
    expect(res.amount).toBe(2700000);
    expect(res.allocations).toHaveLength(3);
    expect(tx.payment.create).toHaveBeenCalled();
  });

  it('recordPaymentAllOutstanding rejects when nothing is outstanding', async () => {
    const prior = [
      { installmentNo: 1, kind: 'INSTALLMENT', amount: 2000000, payment: { status: 'COMPLETED' } },
      { installmentNo: 2, kind: 'INSTALLMENT', amount: 2000000, payment: { status: 'COMPLETED' } },
    ];
    const svc = makeService(makeTx(prior));
    await expect(
      svc.recordPaymentAllOutstanding(TENANT, { studentId: STUDENT_ID, method: 'cash' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ignores REFUNDED payments when computing what is already paid', async () => {
    // The only prior allocation was refunded → full 2,000,000 still outstanding.
    const prior = [
      { installmentNo: 1, kind: 'INSTALLMENT', amount: 2000000, payment: { status: 'REFUNDED' } },
    ];
    const svc = makeService(makeTx(prior));
    const res: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID,
      allocations: [alloc(1, 2000000)],
      method: 'cash',
    });
    expect(res.amount).toBe(2000000);
  });
});

describe('recordPayment realtime broadcast', () => {
  it('broadcasts payment.recorded to the tenant finance room after saving', async () => {
    const { svc, realtime } = makeEmittingService(makeTx());
    const res: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID,
      allocations: [alloc(1, 2000000)],
      method: 'cash',
    });
    expect(res.id).toBe('pay-new');
    expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
      kind: 'payment.recorded',
      rooms: ['tenant:tenant-1:finance'],
      payload: { paymentId: 'pay-new', studentId: STUDENT_ID },
    });
  });

  it('broadcasts payment.recorded after pay-all settles every open target', async () => {
    const { svc, realtime } = makeEmittingService(makeTx());
    const res: any = await svc.recordPaymentAllOutstanding(TENANT, {
      studentId: STUDENT_ID,
      method: 'cash',
    });
    expect(res.id).toBe('pay-new');
    expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
      kind: 'payment.recorded',
      rooms: ['tenant:tenant-1:finance'],
      payload: { paymentId: 'pay-new', studentId: STUDENT_ID },
    });
  });
});
