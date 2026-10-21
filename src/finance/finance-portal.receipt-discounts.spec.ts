import { FinancePortalService } from './finance-portal.service';

const TENANT = 'tenant-1';

describe('getPaymentReceipt with applied discounts', () => {
  it('includes discount lines (label + amount) in the receipt data', async () => {
    const payment: any = {
      id: 'pay-1',
      studentId: 'stu-1',
      paymentReference: null,
      amount: 1400000,
      currencyCode: 'SDG',
      method: 'CASH',
      paidAt: new Date('2026-10-01T10:00:00Z'),
      createdAt: new Date('2026-10-01T10:00:00Z'),
      notes: null,
      student: { id: 'stu-1', firstName: 'Amina', lastName: 'Khalid', educationLevel: 'SECONDARY', grade: 1 },
      allocations: [
        { kind: 'INSTALLMENT', installmentNo: 1, amount: 1400000, feeInstallment: null },
      ],
      discountApplications: [
        { amount: 600000, eligibility: { label: 'Sibling Discount (15%)' } },
      ],
    };
    const tx: any = { payment: { findUnique: jest.fn(async () => payment) } };
    const prisma: any = { withTenantRead: async (_t: string, cb: any) => cb(tx) };
    const noop: any = {};
    const svc: any = new FinancePortalService(prisma, noop, noop, noop, noop, noop, noop, noop, noop, { emitDomainEvent: jest.fn(async () => undefined) } as any);

    let captured: any = null;
    svc.generateReceiptPdf = jest.fn(async (data: any) => {
      captured = data;
      return Buffer.from('%PDF-stub');
    });

    const res = await svc.getPaymentReceipt(TENANT, 'pay-1');
    expect(res.filename).toBe('receipt-pay-1.pdf');
    expect(captured.discounts).toEqual([{ label: 'Sibling Discount (15%)', amount: 600000 }]);
    expect(captured.totalDiscount).toBe(600000);
    // Cash total is unchanged by the discount lines.
    expect(captured.amount).toBe(1400000);
  });

  it('defaults to empty discounts for legacy payments', async () => {
    const payment: any = {
      id: 'pay-2',
      studentId: 'stu-1',
      paymentReference: null,
      amount: 2000000,
      currencyCode: 'SDG',
      method: 'CASH',
      paidAt: new Date('2026-10-01T10:00:00Z'),
      createdAt: new Date('2026-10-01T10:00:00Z'),
      notes: null,
      student: { id: 'stu-1', firstName: 'Amina', lastName: 'Khalid', educationLevel: 'SECONDARY', grade: 1 },
      allocations: [],
      discountApplications: [],
    };
    const tx: any = { payment: { findUnique: jest.fn(async () => payment) } };
    const prisma: any = { withTenantRead: async (_t: string, cb: any) => cb(tx) };
    const noop: any = {};
    const svc: any = new FinancePortalService(prisma, noop, noop, noop, noop, noop, noop, noop, noop, { emitDomainEvent: jest.fn(async () => undefined) } as any);
    let captured: any = null;
    svc.generateReceiptPdf = jest.fn(async (data: any) => {
      captured = data;
      return Buffer.from('%PDF-stub');
    });
    await svc.getPaymentReceipt(TENANT, 'pay-2');
    expect(captured.discounts).toEqual([]);
    expect(captured.totalDiscount).toBe(0);
  });
});
