import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const num = (v: unknown): number => Number(v ?? 0);
const round2 = (v: number): number => Math.round(v * 100) / 100;

export type LedgerType = 'COLLECTION' | 'EXPENSE' | 'PAYROLL' | 'DISCOUNT';

@Injectable()
export class FinanceReportsService {
  constructor(private prisma: PrismaService) {}

  private fullName(u: { firstName: string; lastName?: string | null }): string {
    return `${u.firstName} ${u.lastName ?? ''}`.trim();
  }

  private parseRange(from: unknown, to: unknown): { start: Date; end: Date } {
    const start = new Date(from as string);
    const end = new Date(to as string);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('from/to must be valid ISO dates');
    }
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException('from must not be after to');
    }
    end.setUTCHours(23, 59, 59, 999);
    return { start, end };
  }

  async getSummary(tenantId: string, from: string, to: string) {
    const { start, end } = this.parseRange(from, to);
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [payAgg, expAgg, payrollAgg, discAgg, methods] = await Promise.all([
        tx.payment.aggregate({
          where: { tenantId, status: 'COMPLETED', paidAt: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
        tx.expense.aggregate({
          where: { tenantId, status: 'PAID', date: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
        tx.salaryPayout.aggregate({
          where: { tenantId, status: 'PAID', paidAt: { gte: start, lte: end } },
          _sum: { netAmount: true },
        }),
        tx.discountApplication.aggregate({
          where: { tenantId, createdAt: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
        tx.payment.findMany({
          where: { tenantId, status: 'COMPLETED', paidAt: { gte: start, lte: end } },
          select: { method: true, amount: true },
        }),
      ]);

      const collections = round2(num((payAgg as any)._sum.amount));
      const expenses = round2(num((expAgg as any)._sum.amount) + num((payrollAgg as any)._sum.netAmount));
      const discounts = round2(num((discAgg as any)._sum.amount));

      const byMethodMap = new Map<string, { count: number; total: number }>();
      for (const p of methods as any[]) {
        const cur = byMethodMap.get(p.method) ?? { count: 0, total: 0 };
        cur.count += 1;
        cur.total = round2(cur.total + num(p.amount));
        byMethodMap.set(p.method, cur);
      }
      const byMethod = [...byMethodMap.entries()].map(([method, v]) => ({
        method,
        count: v.count,
        total: v.total,
        share: collections > 0 ? round2((v.total / collections) * 100) : 0,
      })).sort((a, b) => b.total - a.total);

      return { collections, expenses, discounts, net: round2(collections - expenses), byMethod };
    });
  }

  async getLedger(
    tenantId: string,
    query: { from: string; to: string; type?: string },
  ) {
    const { start, end } = this.parseRange(query.from, query.to);
    const type = (query.type ?? 'all').toLowerCase();
    const want = (t: string) => type === 'all' || type === t || (type === 'expenses' && (t === 'expenses' || t === 'payroll'));
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [payments, expenses, payouts, discounts] = await Promise.all([
        want('collections')
          ? tx.payment.findMany({
              where: { tenantId, status: 'COMPLETED', paidAt: { gte: start, lte: end } },
              include: { student: { select: { firstName: true, lastName: true } } },
              orderBy: { paidAt: 'desc' },
              take: 500,
            })
          : [],
        want('expenses')
          ? tx.expense.findMany({
              where: { tenantId, status: { in: ['APPROVED', 'PAID'] }, date: { gte: start, lte: end } },
              include: { category: { select: { name: true } } },
              orderBy: { date: 'desc' },
              take: 500,
            })
          : [],
        want('expenses')
          ? tx.salaryPayout.findMany({
              where: { tenantId, status: 'PAID', paidAt: { gte: start, lte: end } },
              include: { user: { select: { firstName: true, lastName: true } } },
              orderBy: { paidAt: 'desc' },
              take: 500,
            })
          : [],
        want('discounts')
          ? tx.discountApplication.findMany({
              where: { tenantId, createdAt: { gte: start, lte: end } },
              include: {
                student: { select: { firstName: true, lastName: true } },
                eligibility: { select: { label: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 500,
            })
          : [],
      ]);

      // Resolve approver UUIDs to names in one batch query — raw IDs in the
      // ledger are unreadable and leak internal identifiers to accountants.
      const approverIds = [
        ...new Set(
          [...(expenses as any[]), ...(payouts as any[])]
            .map((r) => r.approvedBy)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ];
      const approvers = approverIds.length > 0
        ? await tx.user.findMany({
            where: { id: { in: approverIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const approverName = new Map<string, string>(
        (approvers as any[]).map((u) => [u.id, this.fullName(u)]),
      );
      const byName = (id: unknown): string => {
        if (typeof id !== 'string' || id.length === 0) return '—';
        return approverName.get(id) ?? '—';
      };

      const rows: Array<{
        id: string; at: string; type: LedgerType; title: string;
        channel: string; amount: number; ref: string; by: string;
      }> = [];
      for (const p of payments as any[]) {
        rows.push({
          id: `pay:${p.id}`,
          at: new Date(p.paidAt).toISOString(),
          type: 'COLLECTION',
          title: p.student ? `${this.fullName(p.student)} — Tuition & fees` : 'Tuition & fees',
          channel: p.method,
          amount: round2(num(p.amount)),
          ref: p.paymentReference ?? '',
          by: '—',
        });
      }
      for (const e of expenses as any[]) {
        rows.push({
          id: `exp:${e.id}`,
          at: new Date(e.date).toISOString(),
          type: 'EXPENSE',
          title: [e.category?.name, e.vendor || e.description].filter(Boolean).join(' · ') || 'Expense',
          channel: '—',
          amount: -round2(num(e.amount)),
          ref: '',
          by: byName(e.approvedBy),
        });
      }
      for (const p of payouts as any[]) {
        rows.push({
          id: `po:${p.id}`,
          at: new Date(p.paidAt).toISOString(),
          type: 'PAYROLL',
          title: p.user ? `Salary — ${this.fullName(p.user)} (${p.payslipNo})` : `Salary (${p.payslipNo})`,
          channel: p.paymentMethod ?? '—',
          amount: -round2(num(p.netAmount)),
          ref: p.payslipNo ?? '',
          by: byName(p.approvedBy),
        });
      }
      for (const d of discounts as any[]) {
        rows.push({
          id: `disc:${d.id}`,
          at: new Date(d.createdAt).toISOString(),
          type: 'DISCOUNT',
          title: d.student ? `Discount — ${this.fullName(d.student)} (${d.eligibility?.label ?? 'waiver'})` : 'Discount waiver',
          channel: '—',
          amount: -round2(num(d.amount)),
          ref: '',
          by: '—',
        });
      }
      rows.sort((a, b) => (a.at < b.at ? 1 : -1));
      return rows;
    });
  }
}
