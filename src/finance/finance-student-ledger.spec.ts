import { FinancePortalService } from './finance-portal.service';

const TENANT = 'tenant-1';
const STUDENT = 'student-1';

// Prototype harness: getStudentLedger only touches prisma + private helpers.
function harness(tx: any) {
  const prisma: any = {
    withTenantRead: (_t: string, fn: (t: any) => any) => fn(tx),
  };
  const svc = Object.create(FinancePortalService.prototype);
  svc.prisma = prisma;
  return svc as FinancePortalService;
}

function txBase(over: any = {}) {
  const link = {
    id: 'link-1', studentId: STUDENT,
    totalFee: 10000, currencyCode: 'SDG',
    feeStructure: {
      id: 'fs-1', name: 'Grade 8 Standard (2026/2027)',
      tuitionFee: 9000, registrationFee: 1000, currencyCode: 'SDG',
      installments: [
        { installmentNo: 1, amount: 4500, dueDate: new Date('2027-09-01T00:00:00Z') },
        { installmentNo: 2, amount: 4500, dueDate: new Date('2028-01-15T00:00:00Z') },
      ],
    },
    schoolClass: null,
  };
  return {
    student: {
      findFirst: jest.fn(async () => ({
        id: STUDENT, firstName: 'Lina', lastName: 'Hassan', roleNumber: '26-0007',
        educationLevel: 'BASIC', grade: 8, phone: '+249100000001',
      })),
      findMany: jest.fn(async () => [{ id: STUDENT, educationLevel: 'BASIC', grade: 8 }]),
    },
    studentGuardian: {
      findMany: jest.fn(async () => [
        { relationship: 'Father', isPrimary: true, guardian: { firstName: 'Omar', lastName: 'Hassan', phone: '+249100000002' } },
      ]),
    },
    academicYear: { findFirst: jest.fn(async () => ({ id: 'y1' })) },
    studentFeeStructure: {
      findMany: jest.fn(async () => [link]),
      findFirst: jest.fn(async () => ({
        id: 'link-1', currencyCode: 'SDG', feeStructure: { name: 'Grade 8 Standard (2026/2027)' },
      })),
    },
    studentEnrollment: { findMany: jest.fn(async () => []) },
    paymentAllocation: { findMany: jest.fn(async () => []) },
    discountApplication: {
      findMany: jest.fn(async () => [
        { targetKind: 'INSTALLMENT', installmentNo: 1, amount: 900, eligibilityId: 'e1', studentFeeStructureId: 'link-1' },
      ]),
    },
    payment: { findMany: jest.fn(async () => []) },
    ...over,
  };
}

describe('getStudentLedger', () => {
  it('computes totals as assigned net of discounts minus paid', async () => {
    const tx = txBase({
      paymentAllocation: {
        findMany: jest.fn(async () => [
          { kind: 'INSTALLMENT', installmentNo: 1, amount: 2000, paymentId: 'pay1', studentFeeStructureId: 'link-1', payment: { status: 'COMPLETED' }, createdAt: new Date('2026-09-05T00:00:00Z') },
        ]),
      },
    });
    const out: any = await harness(tx).getStudentLedger(TENANT, STUDENT);
    expect(out.profile).toMatchObject({ name: 'Lina Hassan', roleNumber: '26-0007', grade: 8 });
    expect(out.profile.guardians).toEqual([
      expect.objectContaining({ name: 'Omar Hassan', phone: '+249100000002' }),
    ]);
    expect(out.totals).toMatchObject({ assigned: 9100, paid: 2000, balance: 7100 });
    expect(out.totals.status).toBe('PARTIALLY_PAID');
  });

  it('aggregates lifetime billed and paid across academic years', async () => {
    const tx = txBase();
    const originalFindMany = tx.studentFeeStructure.findMany;
    tx.studentFeeStructure.findMany = jest.fn(async (args: any) =>
      args?.select
        ? [
            { id: 'link-1', totalFee: 10000, transportFee: 0 },
            { id: 'link-0', totalFee: 5000, transportFee: 0 },
          ]
        : originalFindMany(args),
    );
    tx.paymentAllocation.findMany = jest.fn(async () => [
      {
        kind: 'INSTALLMENT', installmentNo: 1, amount: 2000, paymentId: 'pay-current',
        studentFeeStructureId: 'link-1', payment: { status: 'COMPLETED' },
        createdAt: new Date('2026-09-05T00:00:00Z'),
      },
      {
        kind: 'INSTALLMENT', installmentNo: 1, amount: 1000, paymentId: 'pay-prior',
        studentFeeStructureId: 'link-0', payment: { status: 'COMPLETED' },
        createdAt: new Date('2025-09-05T00:00:00Z'),
      },
    ]);

    const out: any = await harness(tx).getStudentLedger(TENANT, STUDENT);
    expect(out.totals).toMatchObject({ assigned: 14100, paid: 3000, balance: 11100 });
  });

  it('marks installments PAID / PARTIAL / OVERDUE correctly', async () => {
    const tx = txBase({
      paymentAllocation: {
        findMany: jest.fn(async () => [
          { kind: 'INSTALLMENT', installmentNo: 1, amount: 3600, paymentId: 'pay1', studentFeeStructureId: 'link-1', payment: { status: 'COMPLETED' }, createdAt: new Date('2026-09-05T00:00:00Z') },
        ]),
      },
    });
    const out: any = await harness(tx).getStudentLedger(TENANT, STUDENT);
    const i1 = out.installments.find((i: any) => i.no === 1);
    const i2 = out.installments.find((i: any) => i.no === 2);
    expect(i1.status).toBe('PAID');
    expect(i2.status).toBe('PENDING');
    expect(out.fee.rows.find((r: any) => r.label === 'Base Tuition')).toMatchObject({
      amount: 9000, discount: 900, net: 8100,
    });
  });

  it('lists payments with target installment names and receipt refs', async () => {
    const tx = txBase({
      payment: {
        findMany: jest.fn(async () => [
          {
            id: 'pay1', paymentReference: 'REC-2026-0842', amount: 2000, currencyCode: 'SDG',
            method: 'BANKAK', paidAt: new Date('2026-09-05T10:00:00Z'), status: 'COMPLETED',
            allocations: [{ kind: 'INSTALLMENT', installmentNo: 1, amount: 2000 }],
          },
        ]),
      },
    });
    const out: any = await harness(tx).getStudentLedger(TENANT, STUDENT);
    expect(out.payments).toHaveLength(1);
    expect(out.payments[0]).toMatchObject({
      ref: 'REC-2026-0842', method: 'BANKAK', amount: 2000, status: 'COMPLETED', by: '-',
    });
    expect(out.payments[0].target).toMatch(/1/);
  });

  it('marks past-due unpaid installments OVERDUE', async () => {
    const tx = txBase();
    const link = await (tx.studentFeeStructure.findMany as jest.Mock)();
    link[0].feeStructure.installments[0].dueDate = new Date('2020-09-01T00:00:00Z');
    const out: any = await harness(tx).getStudentLedger(TENANT, STUDENT);
    expect(out.installments.find((i: any) => i.no === 1).status).toBe('OVERDUE');
    expect(out.totals.status).toBe('OVERDUE');
  });

  it('404s unknown students', async () => {
    const tx = txBase({
      student: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
      },
    });
    await expect(harness(tx).getStudentLedger(TENANT, 'ghost')).rejects.toThrow(/not found/i);
  });
});
