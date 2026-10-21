import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformActor } from './platform-tenants.service';

export type { PlatformActor } from './platform-tenants.service';

export type RecordPaymentInput = {
  tenantId: string;
  licenseId?: string;
  amount: number;
  currency: string;
  method: 'BANK_TRANSFER' | 'CHEQUE' | 'CASH' | 'BANK_API';
  type?: 'MANUAL_TRANSFER' | 'CASH_DEPOSIT' | 'BANK_API_PENDING';
  paidAt: Date;
  reference?: string;
  notes?: string;
};

export type LogExpenseInput = {
  title: string;
  category: 'INFRASTRUCTURE' | 'MARKETING' | 'LEGAL' | 'SUPPORT' | 'OTHER';
  countryCode?: string | null;
  amount: number;
  currency: string;
  paidAt: Date;
  notes?: string;
};

type RateRow = {
  code: string;
  name: string;
  countryCode: string | null;
  rateToUsd: number;
  autoSync: boolean;
  lastSyncedAt: Date | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Platform money: cash received, running costs, and the currency table they
 * are converted with.
 *
 * Two accounting rules, applied consistently:
 *
 * 1. Revenue is cash received (platform_payments), not invoices. An invoice
 *    is a document; a payment is money in. The two are never added together,
 *    so a receipt for a payment cannot be counted twice.
 * 2. Conversions happen at read time with the current rate. A rate change
 *    therefore moves the P&L immediately, which is what an operator expects
 *    from a live rate table. The trade-off is that a past month restated
 *    after a rate change differs from what was reported then.
 */
@Injectable()
export class PlatformFinancialsService {
  constructor(private prisma: PrismaService) {}

  async overview() {
    const [rates, payments, expenses] = await Promise.all([
      this.rates(),
      this.prisma.platformPayment.findMany({
        select: { amount: true, currency: true, paidAt: true },
      }),
      this.prisma.platformExpense.findMany({
        select: {
          amount: true,
          currency: true,
          countryCode: true,
          category: true,
          paidAt: true,
        },
      }),
    ]);

    const rateOf = (currency: string) =>
      rates.find((rate) => rate.code === currency)?.rateToUsd ?? null;

    let revenue = 0;
    let unconvertedPayments = 0;
    const incomeByCountry = new Map<string, number>();
    for (const payment of payments) {
      const amount = Number(payment.amount);
      const rate = rateOf(payment.currency);
      if (rate === null) {
        // A currency with no rate cannot be converted. Counting it as 1:1
        // would quietly invent revenue, so it is reported as unconverted.
        unconvertedPayments += 1;
        continue;
      }
      revenue += amount / rate;
      const country = this.countryOfCurrency(payment.currency, rates);
      if (country) {
        incomeByCountry.set(
          country,
          (incomeByCountry.get(country) ?? 0) + amount,
        );
      }
    }

    let totalExpenses = 0;
    let unconvertedExpenses = 0;
    const expenseByCountry = new Map<string, number>();
    for (const expense of expenses) {
      const amount = Number(expense.amount);
      const rate = rateOf(expense.currency);
      if (rate === null) {
        unconvertedExpenses += 1;
        continue;
      }
      totalExpenses += amount / rate;
      if (expense.countryCode) {
        expenseByCountry.set(
          expense.countryCode,
          (expenseByCountry.get(expense.countryCode) ?? 0) + amount,
        );
      }
    }

    const countryCodes = [
      ...new Set(
        rates
          .map((rate) => rate.countryCode)
          .filter((code): code is string => Boolean(code)),
      ),
    ].sort();

    const countries = countryCodes.map((countryCode) => {
      const localIncome = incomeByCountry.get(countryCode) ?? 0;
      const localExpenses = expenseByCountry.get(countryCode) ?? 0;
      const localNet = localIncome - localExpenses;
      const currency =
        rates.find((rate) => rate.countryCode === countryCode)?.code ?? 'USD';
      const rate = rateOf(currency) ?? 1;
      return {
        countryCode,
        currency,
        rateToUsd: rate,
        localIncome: round2(localIncome),
        localExpenses: round2(localExpenses),
        localNet: round2(localNet),
        netProfitUsd: round2(localNet / rate),
        marginPct: localIncome > 0 ? round2((localNet / localIncome) * 100) : 0,
      };
    });

    const netProfit = revenue - totalExpenses;

    return {
      baseCurrency: 'USD',
      totals: {
        revenue: round2(revenue),
        expenses: round2(totalExpenses),
        netProfit: round2(netProfit),
        marginPct: revenue > 0 ? round2((netProfit / revenue) * 100) : 0,
        paymentCount: payments.length,
        expenseCount: expenses.length,
        unconvertedPayments,
        unconvertedExpenses,
      },
      countries,
      rates: rates.map((rate) => ({
        code: rate.code,
        name: rate.name,
        countryCode: rate.countryCode,
        rateToUsd: rate.rateToUsd,
        autoSync: rate.autoSync,
        lastSyncedAt: rate.lastSyncedAt,
      })),
    };
  }

  async subscriptions() {
    const [rates, tenants] = await Promise.all([
      this.rates(),
      this.prisma.tenant.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          countryCode: true,
          currencyCode: true,
          status: true,
          logoUrl: true,
          licenses: {
            where: { status: 'ACTIVE' },
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
              startedAt: true,
              expiresAt: true,
              seats: true,
              plan: {
                select: { code: true, name: true, price: true, currency: true },
              },
              payments: {
                select: {
                  id: true,
                  amount: true,
                  currency: true,
                  type: true,
                  paidAt: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const rateOf = (currency: string) =>
      rates.find((rate) => rate.code === currency)?.rateToUsd ?? null;

    return tenants.map((tenant) => {
      const license = tenant.licenses[0] ?? null;
      const plan = license?.plan ?? null;
      // The tier price is per student per month, so the monthly amount is
      // the rate times the licensed student count.
      const studentCount = license?.seats ?? 0;
      const pricePerStudent = plan ? Number(plan.price) : 0;
      const priceUsd = pricePerStudent * (studentCount > 0 ? studentCount : 1);
      const currency = tenant.currencyCode || 'USD';
      const rate = rateOf(currency);
      // Without a rate the local price cannot be computed. Showing the USD
      // price as if it were the local price would invoice the wrong amount,
      // so the row is reported as unpriced instead.
      const currencyConfigured = rate !== null;
      const localPrice = rate === null ? null : priceUsd * rate;

      const paidAmount = (license?.payments ?? []).reduce(
        (sum, payment) => sum + Number(payment.amount),
        0,
      );
      const latestPayment = (license?.payments ?? [])
        .slice()
        .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())[0];

      const status = !currencyConfigured
        ? 'UNPRICED'
        : paidAmount <= 0
          ? 'OVERDUE'
          : paidAmount + 1e-9 >= (localPrice ?? 0)
            ? 'PAID'
            : 'PARTIAL';

      return {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        countryCode: tenant.countryCode,
        logoUrl: tenant.logoUrl,
        tenantStatus: tenant.status,
        tier: plan?.code ?? null,
        tierName: plan?.name ?? null,
        licenseId: license?.id ?? null,
        studentCount,
        pricePerStudent,
        startedAt: license?.startedAt ?? null,
        expiresAt: license?.expiresAt ?? null,
        currency,
        currencyConfigured,
        localPrice: localPrice === null ? null : round2(localPrice),
        priceUsd: round2(priceUsd),
        rateToUsd: rate,
        paidAmount: round2(paidAmount),
        outstanding:
          localPrice === null
            ? null
            : round2(Math.max(0, localPrice - paidAmount)),
        status,
        paymentType: latestPayment?.type ?? null,
      };
    });
  }

  async currencies() {
    const rates = await this.rates();
    return rates.map((rate) => ({
      code: rate.code,
      name: rate.name,
      countryCode: rate.countryCode,
      rateToUsd: rate.rateToUsd,
      autoSync: rate.autoSync,
      lastSyncedAt: rate.lastSyncedAt,
    }));
  }

  async updateCurrency(
    code: string,
    input: { rateToUsd: number; autoSync?: boolean },
    actor?: PlatformActor,
  ) {
    if (!Number.isFinite(input.rateToUsd) || input.rateToUsd <= 0) {
      throw new BadRequestException(
        'The exchange rate must be greater than zero',
      );
    }

    const existing = await this.prisma.platformCurrency.findUnique({
      where: { code },
    });
    if (!existing) throw new NotFoundException('Currency not found');

    const updated = await this.prisma.platformCurrency.update({
      where: { code },
      data: {
        rateToUsd: input.rateToUsd,
        ...(input.autoSync === undefined ? {} : { autoSync: input.autoSync }),
        lastSyncedAt: new Date(),
      },
    });

    if (actor) {
      // A rate change moves every converted figure in the console, so it is
      // recorded the same way a payment or an expense is. The currency code
      // is not a uuid, so it travels in the payload rather than in entityId.
      await this.audit(actor, {
        action: 'platform.currency.updated',
        entityType: 'platform_currency',
        newValues: {
          code,
          rateToUsd: input.rateToUsd,
          autoSync: updated.autoSync,
          previousRateToUsd: Number(existing.rateToUsd),
        },
      });
    }

    return {
      code: updated.code,
      name: updated.name,
      countryCode: updated.countryCode,
      rateToUsd: Number(updated.rateToUsd),
      autoSync: updated.autoSync,
      lastSyncedAt: updated.lastSyncedAt,
    };
  }

  async expenses() {
    const rows = await this.prisma.platformExpense.findMany({
      orderBy: { paidAt: 'desc' },
      include: {
        recordedBy: {
          select: {
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      countryCode: row.countryCode,
      amount: Number(row.amount),
      currency: row.currency,
      paidAt: row.paidAt,
      notes: row.notes,
      recordedBy: row.recordedBy
        ? [row.recordedBy.user.firstName, row.recordedBy.user.lastName]
            .filter(Boolean)
            .join(' ') || row.recordedBy.user.email
        : null,
    }));
  }

  async logExpense(input: LogExpenseInput, actor: PlatformActor) {
    if (!input.title?.trim()) {
      throw new BadRequestException('An expense title is required');
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException('The amount must be greater than zero');
    }

    const expense = await this.prisma.platformExpense.create({
      data: {
        title: input.title.trim(),
        category: input.category,
        countryCode: input.countryCode?.trim().toUpperCase() || null,
        amount: input.amount,
        currency: input.currency?.trim().toUpperCase() || 'USD',
        paidAt: input.paidAt,
        notes: input.notes?.trim() || null,
        recordedById: actor.id,
      },
    });

    await this.audit(actor, {
      action: 'platform.expense.logged',
      entityType: 'platform_expense',
      entityId: expense.id,
      newValues: {
        title: expense.title,
        category: expense.category,
        amount: Number(expense.amount),
        currency: expense.currency,
        countryCode: expense.countryCode,
      },
    });

    return {
      id: expense.id,
      title: expense.title,
      category: expense.category,
      countryCode: expense.countryCode,
      amount: Number(expense.amount),
      currency: expense.currency,
      paidAt: expense.paidAt,
    };
  }

  async payments(tenantId?: string) {
    const rows = await this.prisma.platformPayment.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { paidAt: 'desc' },
      include: {
        tenant: { select: { id: true, name: true, countryCode: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      tenantName: row.tenant.name,
      licenseId: row.licenseId,
      amount: Number(row.amount),
      currency: row.currency,
      method: row.method,
      type: row.type,
      paidAt: row.paidAt,
      reference: row.reference,
      notes: row.notes,
    }));
  }

  async recordPayment(input: RecordPaymentInput, actor: PlatformActor) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException('The amount must be greater than zero');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: {
        id: true,
        name: true,
        currencyCode: true,
        licenses: {
          where: input.licenseId
            ? { id: input.licenseId }
            : { status: 'ACTIVE' },
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
    });
    if (!tenant) throw new NotFoundException('School not found');

    const licenseId = input.licenseId ?? tenant.licenses[0]?.id;

    const payment = await this.prisma.platformPayment.create({
      data: {
        tenantId: tenant.id,
        licenseId: licenseId ?? null,
        amount: input.amount,
        currency:
          input.currency?.trim().toUpperCase() || tenant.currencyCode || 'USD',
        method: input.method,
        type: input.type ?? 'MANUAL_TRANSFER',
        paidAt: input.paidAt,
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        recordedById: actor.id,
      },
    });

    await this.audit(actor, {
      action: 'platform.payment.recorded',
      entityType: 'platform_payment',
      entityId: payment.id,
      tenantId: tenant.id,
      newValues: {
        amount: input.amount,
        currency: payment.currency,
        method: payment.method,
        licenseId: licenseId ?? null,
      },
    });

    return {
      id: payment.id,
      tenantId: tenant.id,
      licenseId: licenseId ?? null,
      amount: Number(payment.amount),
      currency: payment.currency,
      method: payment.method,
      type: payment.type,
      paidAt: payment.paidAt,
    };
  }

  /**
   * Issues the billing document for money already received. The invoice is a
   * receipt: it never adds to revenue, which is counted from payments.
   */
  async issueReceipt(
    input: {
      tenantId: string;
      licenseId?: string;
      amount: number;
      currency: string;
    },
    actor: PlatformActor,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: {
        id: true,
        name: true,
        licenses: { select: { id: true }, take: 1 },
      },
    });
    if (!tenant) throw new NotFoundException('School not found');

    const number = await this.nextInvoiceNumber();
    const invoice = await this.prisma.platformInvoice.create({
      data: {
        tenantId: tenant.id,
        licenseId: input.licenseId ?? tenant.licenses[0]?.id ?? null,
        number,
        kind: 'LICENSE',
        status: 'PAID',
        amount: input.amount,
        currency: input.currency.trim().toUpperCase(),
        issuedAt: new Date(),
        paidAt: new Date(),
        recordedById: actor.id,
      },
    });

    await this.audit(actor, {
      action: 'platform.receipt.issued',
      entityType: 'platform_invoice',
      entityId: invoice.id,
      tenantId: tenant.id,
      newValues: { number, amount: input.amount, currency: input.currency },
    });

    return {
      id: invoice.id,
      number: invoice.number,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
    };
  }

  private async nextInvoiceNumber() {
    const year = new Date().getFullYear();
    const existing = await this.prisma.platformInvoice.count({
      where: { number: { startsWith: `PLT-${year}-` } },
    });
    return `PLT-${year}-${String(existing + 1).padStart(4, '0')}`;
  }

  private async rates(): Promise<RateRow[]> {
    const rows = await this.prisma.platformCurrency.findMany({
      select: {
        code: true,
        name: true,
        countryCode: true,
        rateToUsd: true,
        autoSync: true,
        lastSyncedAt: true,
      },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({ ...row, rateToUsd: Number(row.rateToUsd) }));
  }

  private countryOfCurrency(currency: string, rates: RateRow[]): string | null {
    return rates.find((rate) => rate.code === currency)?.countryCode ?? null;
  }

  private async audit(
    actor: PlatformActor,
    entry: {
      action: string;
      entityType: string;
      entityId?: string;
      tenantId?: string;
      oldValues?: unknown;
      newValues?: unknown;
    },
  ) {
    await this.prisma.platformAuditLog.create({
      data: {
        actorId: actor.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        tenantId: entry.tenantId,
        oldValues: entry.oldValues as never,
        newValues: entry.newValues as never,
        ipAddress: actor.ip,
        userAgent: actor.userAgent?.slice(0, 255),
      },
    });
  }
}
