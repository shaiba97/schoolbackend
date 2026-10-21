import { FinancePaymentsService } from './finance.service';

const TENANT = 'tenant-1';

describe('FinancePaymentsService.recordPayment realtime', () => {
  it('broadcasts payment.recorded to the tenant finance room after saving', async () => {
    const payment = {
      id: 'pay-1',
      tenantId: TENANT,
      studentId: 'student-1',
      amount: 1000,
      currencyCode: 'SDG',
      method: 'CASH',
      paymentReference: null,
      status: 'COMPLETED',
    };
    const tx = {
      payment: {
        create: jest.fn(async ({ data }: any) => ({ ...payment, ...data })),
      },
    };
    const prisma = {
      withTenant: async (_t: string, cb: any) => cb(tx),
    } as never;
    const realtime = { emitDomainEvent: jest.fn(async () => undefined) } as any;
    const svc = new FinancePaymentsService(prisma, realtime);

    const created = await svc.recordPayment(TENANT, 'user-1', {
      studentId: 'student-1',
      amount: 1000,
      currencyCode: 'SDG',
      method: 'CASH',
    } as never);

    expect((created as any).id).toBe('pay-1');
    expect(realtime.emitDomainEvent).toHaveBeenCalledWith({
      kind: 'payment.recorded',
      rooms: ['tenant:tenant-1:finance'],
      payload: { paymentId: 'pay-1', studentId: 'student-1' },
    });
  });
});
