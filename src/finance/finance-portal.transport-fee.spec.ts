import { BadRequestException } from '@nestjs/common';
import { FinancePortalService } from './finance-portal.service';

const TENANT = 'tenant-1';
const STUDENT_ID = 'student-1';
const LINK_ID = 'link-1';
const TRANSPORT_FEE = 300000;

// Tuition 4,000,000 / reg 0 / two installments of 2,000,000.
function makePayTx(existingAllocs: any[] = [], linkTransportFee = TRANSPORT_FEE) {
  const tx: any = {
    academicYear: { findFirst: jest.fn(async () => ({ id: 'year-1' })) },
    student: { findFirst: jest.fn(async () => ({ id: STUDENT_ID, educationLevel: 'SECONDARY', grade: 1 })) },
    studentFeeStructure: {
      findFirst: jest.fn(async () => ({
        id: LINK_ID,
        studentId: STUDENT_ID,
        totalFee: 4000000,
        transportFee: linkTransportFee,
        feeStructure: {
          id: 'struct-1',
          registrationFee: 0,
          tuitionFee: 4000000,
          installments: [
            { id: 'fi-1', installmentNo: 1, amount: 2000000 },
            { id: 'fi-2', installmentNo: 2, amount: 2000000 },
          ],
        },
        update: undefined,
      })),
      update: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
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

function makeReadService(tx: any) {
  const prisma: any = {
    withTenant: async (_t: string, cb: any) => cb(tx),
    withTenantRead: async (_t: string, cb: any) => cb(tx),
  };
  const noop: any = {};
  const realtime: any = { emitDomainEvent: jest.fn(async () => undefined) };
  return new FinancePortalService(prisma, noop, noop, noop, noop, noop, noop, noop, noop, realtime);
}

// Build the wider tx used by buildSchedules / getStudentLedger / listPayments.
function makeBillingTx(o: {
  transportFee?: number;
  schedAllocs?: any[];
  payments?: any[];
  installments?: { installmentNo: number; amount: number }[];
} = {}) {
  const link = {
    id: LINK_ID,
    studentId: STUDENT_ID,
    feeStructureId: 'struct-1',
    totalFee: 4000000,
    currencyCode: 'SDG',
    transportFee: o.transportFee ?? 0,
    feeStructure: {
      id: 'struct-1',
      name: 'Annual Plan 2026',
      registrationFee: 0,
      tuitionFee: 4000000,
      frequency: 'ANNUAL',
      installments: (o.installments ?? [
        { installmentNo: 1, amount: 2000000 },
        { installmentNo: 2, amount: 2000000 },
      ]).map((i, ix) => ({ id: `fi-${ix}`, dueDate: new Date('2026-12-01T00:00:00Z'), ...i })),
    },
    schoolClass: null,
  };
  const tx: any = {
    academicYear: { findFirst: jest.fn(async () => ({ id: 'year-1' })) },
    student: {
      findFirst: jest.fn(async () => ({
        id: STUDENT_ID,
        firstName: 'Amina',
        lastName: 'Khalid',
        roleNumber: '2026-001',
        educationLevel: 'SECONDARY',
        grade: 1,
        phone: '0911000000',
      })),
      findMany: jest.fn(async () => []),
    },
    studentGuardian: { findMany: jest.fn(async () => []) },
    studentFeeStructure: {
      findFirst: jest.fn(async () => link),
      findMany: jest.fn(async () => [link]),
      create: jest.fn(async () => link),
      update: jest.fn(async ({ data }: any) => ({ ...link, ...data })),
    },
    studentEnrollment: { findMany: jest.fn(async () => []) },
    paymentAllocation: { findMany: jest.fn(async () => o.schedAllocs ?? []) },
    discountApplication: { findMany: jest.fn(async () => []) },
    payment: { findMany: jest.fn(async () => o.payments ?? []) },
  };
  return tx;
}

const schedAlloc = (paymentId: string, installmentNo: number | null, kind: string, amount: number, createdAt: string) => ({
  installmentNo,
  kind,
  amount,
  studentFeeStructureId: LINK_ID,
  paymentId,
  createdAt: new Date(createdAt),
  payment: { status: 'COMPLETED' },
});

const priorAlloc = (kind: string, amount: number, installmentNo: number | null = null, status = 'COMPLETED') => ({
  installmentNo,
  kind,
  amount,
  payment: { status },
});

describe('recordPayment — TRANSPORT allocations', () => {
  it('accepts a transport allocation and stores it with null installmentNo', async () => {
    const tx = makePayTx();
    const svc = makeService(tx);
    const res: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID,
      allocations: [{ kind: 'transport', amount: TRANSPORT_FEE }],
      method: 'cash',
    });
    expect(res.amount).toBe(TRANSPORT_FEE);
    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allocations: {
            create: [{ studentFeeStructureId: LINK_ID, feeInstallmentId: null, installmentNo: null, amount: TRANSPORT_FEE, kind: 'TRANSPORT' }],
          },
        }),
      }),
    );
  });

  it('accepts transport + installment allocations in one payment', async () => {
    const tx = makePayTx();
    const svc = makeService(tx);
    const res: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID,
      allocations: [
        { installmentNo: 1, kind: 'installment', amount: 2000000 },
        { kind: 'TRANSPORT', amount: 100000 },
      ],
      method: 'cash',
    });
    expect(res.amount).toBe(2100000);
    expect(tx.payment.create).toHaveBeenCalled();
  });

  it('rejects a transport allocation exceeding the transport outstanding', async () => {
    const prior = [priorAlloc('TRANSPORT', 200000)];
    const svc = makeService(makePayTx(prior));
    await expect(
      svc.recordPayment(TENANT, {
        studentId: STUDENT_ID,
        allocations: [{ kind: 'transport', amount: 150000 }],
        method: 'cash',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the exact transport remainder after a partial transport payment', async () => {
    const prior = [priorAlloc('TRANSPORT', 200000)];
    const tx = makePayTx(prior);
    const svc = makeService(tx);
    const res: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID,
      allocations: [{ kind: 'transport', amount: 100000 }],
      method: 'cash',
    });
    expect(res.amount).toBe(100000);
  });

  it('ignores REFUNDED transport allocations when computing the outstanding', async () => {
    const prior = [priorAlloc('TRANSPORT', TRANSPORT_FEE, null, 'REFUNDED')];
    const tx = makePayTx(prior);
    const svc = makeService(tx);
    const res: any = await svc.recordPayment(TENANT, {
      studentId: STUDENT_ID,
      allocations: [{ kind: 'transport', amount: TRANSPORT_FEE }],
      method: 'cash',
    });
    expect(res.amount).toBe(TRANSPORT_FEE);
  });
});

describe('recordPaymentAllOutstanding — transport rides pay-all', () => {
  it('settles the open installment and the transport remainder in one payment', async () => {
    const prior = [priorAlloc('INSTALLMENT', 500000, 1)];
    const tx = makePayTx(prior);
    const svc = makeService(tx);
    const res: any = await svc.recordPaymentAllOutstanding(TENANT, {
      studentId: STUDENT_ID,
      method: 'cash',
    });
    // Install-1 remainder (1,500,000) + install-2 (2,000,000) + transport (300,000).
    expect(res.amount).toBe(3800000);
    const kinds = res.allocations.map((a: any) => a.kind);
    expect(kinds).toContain('TRANSPORT');
    expect(res.allocations.find((a: any) => a.kind === 'TRANSPORT').amount).toBe(300000);
  });

  it('changes nothing for a student without a transport fee', async () => {
    const tx = makePayTx([], 0);
    const svc = makeService(tx);
    const res: any = await svc.recordPaymentAllOutstanding(TENANT, {
      studentId: STUDENT_ID,
      method: 'cash',
    });
    expect(res.allocations.map((a: any) => a.kind)).not.toContain('TRANSPORT');
  });

  it('still settles via transport remainder after full-settlement discounts used their targets', async () => {
    // Discounts are out of scope here (no discountIds), so the transport
    // remainder must ride along even when the discount branch was not taken.
    const tx = makePayTx([priorAlloc('INSTALLMENT', 2000000, 1), priorAlloc('INSTALLMENT', 2000000, 2)]);
    const svc = makeService(tx);
    const res: any = await svc.recordPaymentAllOutstanding(TENANT, {
      studentId: STUDENT_ID,
      method: 'cash',
    });
    expect(res.amount).toBe(300000);
    expect(res.allocations).toHaveLength(1);
    expect(res.allocations[0].kind).toBe('TRANSPORT');
  });
});

describe('buildSchedules — transport totals', () => {
  it('adds transportFee to the bill and transportPaid to the collected total', async () => {
    const tx = makeBillingTx({
      transportFee: TRANSPORT_FEE,
      schedAllocs: [
        schedAlloc('pay-1', 1, 'INSTALLMENT', 2000000, '2026-10-01T10:00:00Z'),
        schedAlloc('pay-2', null, 'TRANSPORT', 100000, '2026-10-02T10:00:00Z'),
      ],
    });
    const svc = makeReadService(tx);
    const sched: any = await svc.getStudentSchedule(TENANT, STUDENT_ID);
    expect(sched.transportFee).toBe(TRANSPORT_FEE);
    expect(sched.transportPaid).toBe(100000);
    expect(sched.totalFee).toBe(4300000);
    expect(sched.totalPaid).toBe(2100000);
    expect(sched.balance).toBe(2200000);
  });

  it('reports paid_in_full once transport completes the annual bill', async () => {
    const tx = makeBillingTx({
      transportFee: TRANSPORT_FEE,
      schedAllocs: [
        schedAlloc('pay-1', 1, 'INSTALLMENT', 2000000, '2026-10-01T10:00:00Z'),
        schedAlloc('pay-2', 2, 'INSTALLMENT', 2000000, '2026-10-02T10:00:00Z'),
        schedAlloc('pay-3', null, 'TRANSPORT', TRANSPORT_FEE, '2026-10-03T10:00:00Z'),
      ],
    });
    const svc = makeReadService(tx);
    const sched: any = await svc.getStudentSchedule(TENANT, STUDENT_ID);
    expect(sched.status).toBe('paid_in_full');
  });
});

describe('getStudentLedger — transport rows and totals', () => {
  it('adds a Transport Fee fee row that feeds the assigned total', async () => {
    const tx = makeBillingTx({
      transportFee: TRANSPORT_FEE,
      schedAllocs: [schedAlloc('pay-1', null, 'TRANSPORT', TRANSPORT_FEE, '2026-10-02T10:00:00Z')],
      payments: [
        {
          id: 'pay-1',
          studentId: STUDENT_ID,
          amount: TRANSPORT_FEE,
          currencyCode: 'SDG',
          method: 'CASH',
          paymentReference: null,
          status: 'COMPLETED',
          paidAt: new Date('2026-10-02T10:00:00Z'),
          createdAt: new Date('2026-10-02T10:00:00Z'),
          allocations: [{ kind: 'TRANSPORT', installmentNo: null, amount: TRANSPORT_FEE }],
        },
      ],
    });
    const svc = makeReadService(tx);
    const ledger: any = await svc.getStudentLedger(TENANT, STUDENT_ID);
    expect(ledger.fee.rows.map((r: any) => r.label)).toContain('Transport Fee');
    const row = ledger.fee.rows.find((r: any) => r.label === 'Transport Fee');
    expect(row.amount).toBe(TRANSPORT_FEE);
    expect(row.net).toBe(TRANSPORT_FEE);
    expect(ledger.fee.total).toBe(4300000);
    expect(ledger.totals.paid).toBe(TRANSPORT_FEE);
    expect(ledger.totals.balance).toBe(4000000);
    expect(ledger.totals.status).toBe('PARTIALLY_PAID');
  });

  it('labels transport payment targets "Transport"', async () => {
    const tx = makeBillingTx({
      transportFee: TRANSPORT_FEE,
      payments: [
        {
          id: 'pay-1',
          studentId: STUDENT_ID,
          amount: TRANSPORT_FEE,
          currencyCode: 'SDG',
          method: 'CASH',
          paymentReference: null,
          status: 'COMPLETED',
          paidAt: new Date('2026-10-02T10:00:00Z'),
          createdAt: new Date('2026-10-02T10:00:00Z'),
          allocations: [{ kind: 'TRANSPORT', installmentNo: null, amount: TRANSPORT_FEE }],
        },
      ],
    });
    const svc = makeReadService(tx);
    const ledger: any = await svc.getStudentLedger(TENANT, STUDENT_ID);
    expect(ledger.payments[0].target).toBe('Transport');
  });
});

describe('listPayments — transport labels and progress', () => {
  const payRow = (id: string, amount: number, allocations: any[]) => ({
    id,
    studentId: STUDENT_ID,
    amount,
    currencyCode: 'SDG',
    method: 'CASH',
    paymentReference: null,
    status: 'COMPLETED',
    paidAt: new Date('2026-10-02T10:00:00Z'),
    createdAt: new Date('2026-10-02T10:00:00Z'),
    student: { id: STUDENT_ID, firstName: 'Amina', lastName: 'Khalid', educationLevel: 'SECONDARY', grade: 1 },
    allocations,
  });

  it("labels a transport-only payment 'Transport'", async () => {
    const tx = makeBillingTx({
      transportFee: TRANSPORT_FEE,
      schedAllocs: [schedAlloc('pay-1', null, 'TRANSPORT', TRANSPORT_FEE, '2026-10-02T10:00:00Z')],
      payments: [payRow('pay-1', TRANSPORT_FEE, [{ kind: 'TRANSPORT', installmentNo: null, amount: TRANSPORT_FEE, createdAt: new Date('2026-10-02T10:00:00Z') }])],
    });
    const svc = makeReadService(tx);
    const rows: any[] = await svc.listPayments(TENANT);
    expect(rows[0].allocationTarget).toBe('Transport');
    expect(rows[0].installmentProgress).toMatchObject({ invoiceAmount: TRANSPORT_FEE, amountPaidToDate: TRANSPORT_FEE, percent: 100 });
  });
});

describe('setStudentTransportFee / getTransportFeeStatus', () => {
  it('sets the transport fee on the student link and echoes it', async () => {
    const tx = makePayTx();
    const svc = makeService(tx);
    const res: any = await svc.setStudentTransportFee(TENANT, STUDENT_ID, 250000);
    expect(res).toEqual({ studentId: STUDENT_ID, transportFee: 250000 });
    expect(tx.studentFeeStructure.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LINK_ID } as any,
        data: { transportFee: 250000 },
      }),
    );
  });

  it('rejects a negative amount', async () => {
    const svc = makeService(makePayTx());
    await expect(svc.setStudentTransportFee(TENANT, STUDENT_ID, -1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the student has no linked fee structure', async () => {
    const tx = makePayTx();
    // No link for this student + no resolvable structure => resolveStudentLink
    // throws the canonical "No matching fee structure" BadRequest.
    tx.studentFeeStructure.findFirst = jest.fn(async () => null);
    tx.feeStructure = { findMany: jest.fn(async () => []) };
    const svc = makeService(tx);
    await expect(svc.setStudentTransportFee(TENANT, STUDENT_ID, 250000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns PAID / PARTIAL / PENDING from allocations', async () => {
    const tx = makeBillingTx({
      transportFee: TRANSPORT_FEE,
      schedAllocs: [
        schedAlloc('pay-1', null, 'TRANSPORT', TRANSPORT_FEE, '2026-10-02T10:00:00Z'),
      ],
    });
    const svc = makeReadService(tx);
    const rows: any[] = await svc.getTransportFeeStatus(TENANT, [STUDENT_ID]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentId: STUDENT_ID,
      transportFee: TRANSPORT_FEE,
      transportPaid: TRANSPORT_FEE,
      status: 'PAID',
    });
  });

  it('flags a not-billed student as NOT_BILLED', async () => {
    const tx = makeBillingTx({ transportFee: 0 });
    const svc = makeReadService(tx);
    const rows: any[] = await svc.getTransportFeeStatus(TENANT, [STUDENT_ID]);
    expect(rows[0].status).toBe('NOT_BILLED');
  });
});
