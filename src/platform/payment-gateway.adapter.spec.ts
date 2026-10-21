import {
  ManualPaymentGatewayAdapter,
  PaymentGatewayAdapter,
  PaymentGatewayRegistry,
} from './payment-gateway.adapter';

describe('ManualPaymentGatewayAdapter', () => {
  it('completes the intent as soon as a person records the payment', async () => {
    const adapter = new ManualPaymentGatewayAdapter();

    const intent = await adapter.createPaymentIntent({
      tenantId: 'tenant-1',
      amount: 5000,
      currency: 'SAR',
      paidAt: new Date('2026-04-02'),
    });

    expect(intent.provider).toBe('MANUAL');
    expect(intent.status).toBe('COMPLETED');
    expect(intent.paidAt).toEqual(new Date('2026-04-02'));
  });

  it('keeps a bank reference when one is supplied', async () => {
    const adapter = new ManualPaymentGatewayAdapter();

    const intent = await adapter.createPaymentIntent({
      tenantId: 'tenant-1',
      amount: 100,
      currency: 'SAR',
      reference: 'TRF-9912',
    });

    expect(intent.reference).toBe('TRF-9912');
  });

  it('accepts any currency', () => {
    const adapter = new ManualPaymentGatewayAdapter();
    expect(adapter.supports('SAR')).toBe(true);
    expect(adapter.supports('SDG')).toBe(true);
  });

  it('has nothing to verify for a manual entry', async () => {
    const adapter = new ManualPaymentGatewayAdapter();
    expect(await adapter.verify('TRF-9912')).toBeNull();
  });
});

describe('PaymentGatewayRegistry', () => {
  it('falls back to the manual adapter', () => {
    const registry = new PaymentGatewayRegistry(
      new ManualPaymentGatewayAdapter(),
    );
    expect(registry.resolve('SAR').name).toBe('MANUAL');
  });

  it('prefers a registered adapter that supports the currency', async () => {
    const registry = new PaymentGatewayRegistry(
      new ManualPaymentGatewayAdapter(),
    );

    class BankAdapter extends PaymentGatewayAdapter {
      readonly name = 'BANK';
      supports(currency: string) {
        return currency === 'SAR';
      }
      async createPaymentIntent() {
        return {
          provider: this.name,
          status: 'PENDING' as const,
          reference: 'BANK-1',
          paidAt: new Date(),
        };
      }
      async verify() {
        return null;
      }
    }

    registry.register(new BankAdapter());

    expect(registry.resolve('SAR').name).toBe('BANK');
    expect(registry.resolve('SDG').name).toBe('MANUAL');
  });
});
