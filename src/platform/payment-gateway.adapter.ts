import { Injectable } from '@nestjs/common';

export type PaymentIntentRequest = {
  tenantId: string;
  amount: number;
  currency: string;
  reference?: string;
  paidAt?: Date;
  notes?: string;
};

export type PaymentIntent = {
  /** Which adapter produced the intent. */
  provider: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  /** Bank reference, deposit slip id, or gateway transaction id. */
  reference: string;
  paidAt: Date;
  /** Adapter-specific payload, kept for reconciliation with the provider. */
  raw?: unknown;
};

/**
 * The seam between the platform books and however money actually arrives.
 *
 * Today only manual entry exists, and it is registered as the manual
 * adapter. A bank integration (Tap, MyFatoorah, Bankak, a core-banking
 * webhook) becomes a second adapter that implements this contract: it
 * creates and verifies intents against the provider and hands the platform
 * the same shape. The database already stores what it needs - amount,
 * currency, method, type, reference, paidAt - so a new adapter does not
 * require a schema change.
 */
export abstract class PaymentGatewayAdapter {
  /** Stable identifier stored on the payment row's method history. */
  abstract readonly name: string;

  /** Whether this adapter can handle a given currency. */
  abstract supports(currency: string): boolean;

  /** Creates (or records) an intent to collect money. */
  abstract createPaymentIntent(
    request: PaymentIntentRequest,
  ): Promise<PaymentIntent>;

  /** Looks an intent up again, for webhook reconciliation. */
  abstract verify(reference: string): Promise<PaymentIntent | null>;
}

/**
 * Manual entry: a person tells the platform what arrived. The intent is
 * complete the moment it is created.
 */
@Injectable()
export class ManualPaymentGatewayAdapter extends PaymentGatewayAdapter {
  readonly name = 'MANUAL';

  private readonly intents = new Map<string, PaymentIntent>();
  private counter = 0;

  supports(currency: string): boolean {
    // Manual entry has no currency restriction.
    return typeof currency === 'string';
  }

  createPaymentIntent(request: PaymentIntentRequest): Promise<PaymentIntent> {
    this.counter += 1;
    const intent: PaymentIntent = {
      provider: this.name,
      status: 'COMPLETED',
      reference:
        request.reference?.trim() ||
        `MANUAL-${Date.now()}-${String(this.counter).padStart(4, '0')}`,
      paidAt: request.paidAt ?? new Date(),
      raw: { notes: request.notes ?? null },
    };
    this.intents.set(intent.reference, intent);
    return Promise.resolve(intent);
  }

  /**
   * Manual entries are remembered by the adapter, so a later reconciliation
   * can still ask what was recorded against a reference. A bank adapter
   * would answer from the provider instead.
   */
  verify(reference: string): Promise<PaymentIntent | null> {
    return Promise.resolve(this.intents.get(reference) ?? null);
  }
}

/**
 * Resolves the adapter for a currency. Register bank adapters here; the
 * manual adapter stays the fallback so an unconfigured provider never
 * blocks recording a payment.
 */
@Injectable()
export class PaymentGatewayRegistry {
  private readonly adapters: PaymentGatewayAdapter[];

  constructor(manual: ManualPaymentGatewayAdapter) {
    this.adapters = [manual];
  }

  register(adapter: PaymentGatewayAdapter) {
    this.adapters.unshift(adapter);
  }

  resolve(currency: string): PaymentGatewayAdapter {
    return (
      this.adapters.find((adapter) => adapter.supports(currency)) ??
      this.adapters[this.adapters.length - 1]
    );
  }
}
