import { randomUUID } from 'crypto';
import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateFeeCategoryDto, UpdateFeeCategoryDto,
  CreatePaymentDto, ReversePaymentDto,
  CreateDiscountTypeDto, AssignDiscountDto,
  CreateScholarshipDto, AssignScholarshipDto,
  CreateExpenseCategoryDto, CreateExpenseDto, CreateRefundDto,
  CreateAccountDto, RecordTransactionDto, DailyClosingDto, BankReconciliationDto,
  CreatePeriodDto, CreatePaymentMethodDto, ApproveDto,
} from './dto/finance.dto';
import { RealtimeGateway, financeRoom } from '../realtime/realtime.gateway';
import { bridgeStudentDiscountApproval } from './discount-eligibility.bridge';
import { computeClassToppers } from './topper.helper';

const num = (v: unknown): number => Number(v ?? 0);
const TOPPER_VALUE_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT'];

const SELF_TARGET_BLOCK = 'Cannot modify your own financial records through this screen';

@Injectable()
export class FinanceCategoriesService {
  constructor(private prisma: PrismaService) {}

  async createFeeCategory(tenantId: string, dto: CreateFeeCategoryDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const name = dto.name.trim();
      const existing = await tx.feeCategory.findFirst({ where: { tenantId, name } });
      if (existing) throw new ConflictException(`Fee category "${name}" already exists`);
      return tx.feeCategory.create({ data: { tenantId, ...dto, name } });
    });
  }

  async listFeeCategories(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.feeCategory.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    );
  }

  async updateFeeCategory(tenantId: string, id: string, dto: UpdateFeeCategoryDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.feeCategory.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Fee category not found');
      const data = dto.name === undefined ? dto : { ...dto, name: dto.name.trim() };
      if (data.name) {
        const clash = await tx.feeCategory.findFirst({
          where: { tenantId, name: data.name, NOT: { id } },
        });
        if (clash) throw new ConflictException(`Fee category "${data.name}" already exists`);
      }
      return tx.feeCategory.update({ where: { id }, data });
    });
  }

  async deleteFeeCategory(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.feeCategory.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Fee category not found');
      await tx.feeCategory.delete({ where: { id } });
      return { deleted: true };
    });
  }

  async createExpenseCategory(tenantId: string, dto: CreateFeeCategoryDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.expenseCategory.create({ data: { tenantId, ...dto } }),
    );
  }

  async listExpenseCategories(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.expenseCategory.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    );
  }

  async updateExpenseCategory(tenantId: string, id: string, dto: UpdateFeeCategoryDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.expenseCategory.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Expense category not found');
      return tx.expenseCategory.update({ where: { id }, data: dto });
    });
  }

  async deleteExpenseCategory(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.expenseCategory.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Expense category not found');
      await tx.expenseCategory.delete({ where: { id } });
      return { deleted: true };
    });
  }
}

@Injectable()
export class FinancePaymentsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeGateway,
  ) {}

  async recordPayment(tenantId: string, userId: string, dto: CreatePaymentDto, initialStatus: 'PENDING' | 'COMPLETED' = 'COMPLETED') {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const payment = await tx.payment.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          amount: dto.amount,
          currencyCode: dto.currencyCode,
          method: dto.method as 'CASH' | 'BANKAK' | 'FAWRY' | 'OKASH' | 'AL_MASHRIQ',
          paymentReference: dto.reference,
          status: initialStatus,
        },
      });

      await this.realtime.emitDomainEvent({
        kind: 'payment.recorded',
        rooms: [financeRoom(tenantId)],
        payload: { paymentId: payment.id, studentId: dto.studentId },
      });

      return payment;
    });
  }

  async listPayments(tenantId: string, studentId?: string, status?: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.payment.findMany({
        where: { tenantId, ...(studentId ? { studentId } : {}), ...(status ? { status: status as any } : {}) },
        include: { student: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { paidAt: 'desc' },
      }),
    );
  }

  async verifyPayment(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id, tenantId } });
      if (!payment) throw new NotFoundException('Payment not found');
      return tx.payment.update({ where: { id }, data: { status: 'COMPLETED' } });
    });
  }

  async reversePayment(tenantId: string, userId: string, id: string, dto: ReversePaymentDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const payment = await tx.payment.findFirst({ where: { id, tenantId } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.studentId === userId) throw new ForbiddenException(SELF_TARGET_BLOCK);
      await tx.payment.update({ where: { id }, data: { status: 'REFUNDED', notes: dto.reason } });
      return { reversed: true };
    });
  }
}

@Injectable()
export class FinanceDiscountsService {
  constructor(private prisma: PrismaService) {}

  async createDiscountType(tenantId: string, dto: CreateDiscountTypeDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.discountType.create({ data: { tenantId, ...dto } }),
    );
  }

  async listDiscountTypes(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.discountType.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    );
  }

  // --- Unified discount-rules list (2-tab workspace) -------------------------
  // Merges sibling rules, topper rules, and discount types into one shape so
  // the rules tab and the assign-modal template picker share a source.
  // Discount types carry no stored value (set at assign time) → value null.
  async listDiscountRules(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [siblings, toppers, types] = await Promise.all([
        tx.siblingDiscountRule.findMany({ where: { tenantId }, orderBy: [{ isActive: 'desc' }, { minSiblingCount: 'asc' }] }),
        tx.topperDiscountRule.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
        tx.discountType.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
      ]);
      const relationLabel =
        ({ SISTERS: 'Sisters', BROTHERS: 'Brothers', SISTERS_AND_BROTHERS: 'Sisters and brothers' } as Record<string, string>);
      const kindToValueType = (kind: unknown) => {
        const k = String(kind ?? '').toLowerCase();
        if (k === 'percentage') return 'PERCENTAGE';
        if (k === 'fixed' || k === 'fixed_amount') return 'FIXED_AMOUNT';
        return null;
      };
      return [
        ...siblings.map((r: any) => ({
          id: r.id,
          source: 'SIBLING_RULE',
          name: r.name,
          category: 'SIBLING',
          valueType: r.valueType,
          value: num(r.value),
          description: `${relationLabel[String(r.relationType)] ?? String(r.relationType)}, min ${r.minSiblingCount} sibling${Number(r.minSiblingCount) === 1 ? '' : 's'}`,
          isActive: r.isActive,
        })),
        ...toppers.map((r: any) => ({
          id: r.id,
          source: 'TOPPER_RULE',
          name: r.name,
          category: 'TOPPER',
          valueType: r.valueType,
          value: num(r.value),
          description: null,
          isActive: r.isActive,
        })),
        ...types.map((d: any) => ({
          id: d.id,
          source: 'DISCOUNT_TYPE',
          name: d.name,
          category: 'MANUAL',
          valueType: kindToValueType(d.kind),
          value: null,
          description: null,
          isActive: true,
        })),
      ];
    });
  }

  async createScholarship(tenantId: string, dto: CreateScholarshipDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.scholarship.create({ data: { tenantId, ...dto } }),
    );
  }

  async listScholarships(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.scholarship.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    );
  }

  private assignTypeName(category?: string, name?: string): string {
    const custom = String(name ?? '').trim();
    if (custom) return custom;
    return category === 'SIBLING' ? 'Sibling / Family'
      : category === 'TOPPER' ? 'Class Topper'
      : 'Manual Discount';
  }

  private percentInRange(valueType: unknown, value: unknown): boolean {
    const n = Number(value);
    if (!(n >= 0)) return false;
    if (valueType === 'PERCENTAGE' && !(n <= 100)) return false;
    return true;
  }

  async assignDiscount(tenantId: string, dto: AssignDiscountDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      // Tenant-membership checks: ids arrive from the client and must be
      // proven inside this tenant — never trust them into a blind insert.
      const student = await tx.student.findFirst({ where: { id: dto.studentId, tenantId }, select: { id: true } });
      if (!student) throw new NotFoundException('Student not found');
      let typeId = dto.discountTypeId;
      let effectiveKind: string | null = null;
      if (typeId) {
        const type = await tx.discountType.findFirst({ where: { id: typeId, tenantId }, select: { id: true, kind: true } });
        if (!type) throw new NotFoundException('Discount type not found');
        effectiveKind = String(type.kind ?? '').toLowerCase();
      } else {
        if (dto.valueType !== 'PERCENTAGE' && dto.valueType !== 'FIXED_AMOUNT') {
          throw new BadRequestException('valueType must be PERCENTAGE or FIXED_AMOUNT when no discountTypeId is given');
        }
        effectiveKind = dto.valueType === 'PERCENTAGE' ? 'percentage' : 'fixed';
      }
      // Percentage cap resolved against the effective kind so the legacy
      // discountTypeId path cannot smuggle a 9999% value past the guard.
      if (!this.percentInRange(effectiveKind === 'percentage' ? 'PERCENTAGE' : 'FIXED_AMOUNT', dto.value)) {
        throw new BadRequestException(
          effectiveKind === 'percentage' ? 'Percentage value must be between 0 and 100' : 'Value must be >= 0',
        );
      }
      if (!typeId) {
        const name = this.assignTypeName(dto.category, dto.name);
        const kind = effectiveKind as string;
        const existing = await tx.discountType.findFirst({ where: { tenantId, name, kind } });
        if (existing) {
          typeId = existing.id;
        } else {
          try {
            const created: any = await tx.discountType.create({
              data: { tenantId, name, kind },
            });
            typeId = created.id;
          } catch (e: any) {
            // Lost a find-or-create race: re-read the winner instead of 500ing.
            // Re-read is name-only because the unique key is [tenantId, name];
            // a winner of the opposite kind is a real conflict → honest 400.
            if (e?.code !== 'P2002') throw e;
            const winner: any = await tx.discountType.findFirst({ where: { tenantId, name } });
            if (!winner) throw e;
            if (String(winner.kind ?? '').toLowerCase() !== kind) {
              throw new BadRequestException(
                `A discount type named "${name}" already exists with a different value type`,
              );
            }
            typeId = winner.id;
          }
        }
      }
      return tx.studentDiscount.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          discountTypeId: typeId!,
          value: dto.value,
          snapshotValue: dto.value,
          // A manually-assigned sibling discount is sibling-sourced: it renders
          // the SIBLING badge and bridges to a SIBLING eligibility on approval.
          relationApplied: dto.category === 'SIBLING' ? 'MANUAL_ASSIGN' : null,
          status: 'PENDING',
        },
      });
    });
  }

  async assignScholarship(tenantId: string, dto: AssignScholarshipDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.studentScholarship.create({ data: { tenantId, ...dto, status: 'PENDING' } }),
    );
  }

  async listPendingApprovals(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [discounts, scholarships] = await Promise.all([
        tx.studentDiscount.findMany({ where: { tenantId, status: 'PENDING' }, include: { student: { select: { id: true, firstName: true, lastName: true } }, discountType: true } }),
        tx.studentScholarship.findMany({ where: { tenantId, status: 'PENDING' }, include: { student: { select: { id: true, firstName: true, lastName: true } }, scholarship: true } }),
      ]);
      return { discounts, scholarships };
    });
  }

  async approveDiscount(tenantId: string, userId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row: any = await tx.studentDiscount.findFirst({
        where: { id, tenantId },
        include: { discountType: { select: { name: true, kind: true } } },
      });
      if (!row) throw new NotFoundException('Discount not found');
      if (row.status !== 'PENDING') throw new BadRequestException('Only pending discounts can be approved');
      const updated = await tx.studentDiscount.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy: userId },
      });
      // Bridge: an approval materialises the payment-time eligibility row.
      await bridgeStudentDiscountApproval(tx, tenantId, {
        id: row.id,
        studentId: row.studentId,
        value: row.value,
        snapshotValue: row.snapshotValue,
        relationApplied: row.relationApplied,
        discountTypeName: row.discountType?.name,
        discountTypeKind: row.discountType?.kind,
      });
      return updated;
    });
  }

  async rejectDiscount(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.studentDiscount.findFirst({ where: { id, tenantId } });
      if (!row) throw new NotFoundException('Discount not found');
      if (row.status !== 'PENDING') throw new BadRequestException('Only pending discounts can be rejected');
      return tx.studentDiscount.update({ where: { id }, data: { status: 'REJECTED' } });
    });
  }

  // --- Topper-of-class rules ------------------------------------------------

  async listTopperRules(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.topperDiscountRule.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    );
  }

  async createTopperRule(
    tenantId: string,
    dto: { name: string; valueType: string; value: number },
  ) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Rule name is required');
    if (!TOPPER_VALUE_TYPES.includes(String(dto.valueType))) {
      throw new BadRequestException('valueType must be PERCENTAGE or FIXED_AMOUNT');
    }
    if (!(Number(dto.value) >= 0)) throw new BadRequestException('value must be >= 0');
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.topperDiscountRule.create({
        data: { tenantId, name, valueType: dto.valueType as any, value: dto.value },
      }),
    );
  }

  async updateTopperRule(
    tenantId: string,
    id: string,
    dto: { name?: string; valueType?: string; value?: number; isActive?: boolean },
  ) {
    const existing = await this.prisma.withTenantRead(tenantId, (tx) =>
      tx.topperDiscountRule.findFirst({ where: { id, tenantId } }),
    );
    if (!existing) throw new NotFoundException('Topper discount rule not found');
    const data: any = {};
    if (dto.name !== undefined) {
      const name = String(dto.name).trim();
      if (!name) throw new BadRequestException('Rule name is required');
      data.name = name;
    }
    if (dto.valueType !== undefined) {
      if (!TOPPER_VALUE_TYPES.includes(String(dto.valueType))) {
        throw new BadRequestException('valueType must be PERCENTAGE or FIXED_AMOUNT');
      }
      data.valueType = dto.valueType;
    }
    if (dto.value !== undefined) {
      if (!(Number(dto.value) >= 0)) throw new BadRequestException('value must be >= 0');
      data.value = dto.value;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.topperDiscountRule.update({ where: { id }, data }),
    );
  }

  async deleteTopperRule(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.topperDiscountRule.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Topper discount rule not found');
      return tx.topperDiscountRule.delete({ where: { id } });
    });
  }

  // --- Eligible discounts (payment-time source of truth) --------------------

  async listEligibleDiscounts(tenantId: string, studentId: string, academicYearId?: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows: any[] = await tx.discountEligibility.findMany({
        where: { tenantId, studentId },
        orderBy: { createdAt: 'asc' },
      });
      const now = new Date();
      return rows
        .filter((r) => {
          if (academicYearId && r.academicYearId && String(r.academicYearId) !== academicYearId) return false;
          if (r.expiresAt && new Date(r.expiresAt) <= now) return false;
          const applied = num(r.appliedAmount);
          // FIXED rows are fully consumed when appliedAmount reaches value.
          // PERCENTAGE rows store the percent in `value` and currency consumed
          // in `appliedAmount`, so consumption is decided at payment time.
          if (r.valueType === 'FIXED_AMOUNT' && applied >= num(r.value)) return false;
          return true;
        })
        .map((r) => ({
          id: r.id,
          sourceType: r.sourceType,
          valueType: r.valueType,
          value: num(r.value),
          appliedAmount: num(r.appliedAmount),
          label: r.label,
          academicYearId: r.academicYearId ?? null,
          expiresAt: r.expiresAt ?? null,
          preChecked: r.sourceType === 'SIBLING' || r.sourceType === 'TOPPER',
        }));
    });
  }

  // --- Topper computation ----------------------------------------------------

  async computeTopperAwards(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const exam: any = await tx.exam.findFirst({
        where: { tenantId, status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
      });
      if (!exam) throw new NotFoundException('No published exam found');
      const year: any = await tx.academicYear.findUnique({ where: { id: exam.academicYearId } });
      const subjects: any[] = await tx.examSubject.findMany({
        where: { tenantId, examId: exam.id },
        include: { classSubject: { select: { classId: true, schoolClass: { select: { className: true } } } } },
      });
      const classOf = new Map<string, { classId: string; className: string }>();
      const classNames = new Map<string, string>();
      for (const s of subjects ?? []) {
        classOf.set(s.id, {
          classId: s.classSubject?.classId,
          className: s.classSubject?.schoolClass?.className ?? 'class',
        });
        if (s.classSubject?.classId) {
          classNames.set(s.classSubject.classId, s.classSubject?.schoolClass?.className ?? 'class');
        }
      }
      const results: any[] = await tx.examResult.findMany({
        where: {
          tenantId,
          examSubjectId: { in: [...classOf.keys()] },
          kind: 'MAJOR',
          status: 'PUBLISHED',
        },
        select: { studentId: true, examSubjectId: true, marks: true },
      });
      const roster: any[] = await tx.studentEnrollment.findMany({
        where: { tenantId, academicYearId: exam.academicYearId, status: 'ACTIVE' },
        select: { studentId: true, classId: true },
      });
      const rules: any[] = await tx.topperDiscountRule.findMany({ where: { tenantId, isActive: true } });

      const markRows = (results ?? [])
        .filter((r) => r.marks != null && classOf.has(r.examSubjectId))
        .map((r) => ({
          studentId: String(r.studentId),
          classId: classOf.get(r.examSubjectId)!.classId,
          marks: num(r.marks),
          kind: 'MAJOR' as const,
          status: 'PUBLISHED',
        }));
      const winners = computeClassToppers(
        markRows,
        (roster ?? []).map((e: any) => ({ studentId: String(e.studentId), classId: String(e.classId) })),
      );

      let awarded = 0;
      let skipped = 0;
      for (const rule of rules ?? []) {
        for (const w of winners) {
          const existing = await tx.discountEligibility.findFirst({
            where: {
              tenantId,
              studentId: w.studentId,
              sourceType: 'TOPPER',
              sourceRefId: rule.id,
              academicYearId: exam.academicYearId,
            },
          });
          if (existing) {
            skipped += 1;
            continue;
          }
          const className = classNames.get(w.classId) ?? 'class';
          await tx.discountEligibility.create({
            data: {
              tenantId,
              studentId: w.studentId,
              sourceType: 'TOPPER',
              sourceRefId: rule.id,
              valueType: rule.valueType,
              value: rule.value,
              label: `Topper of ${className} — ${exam.name}`,
              academicYearId: exam.academicYearId,
              expiresAt: year?.endsOn ?? null,
            },
          });
          awarded += 1;
        }
      }
      return { examId: exam.id, examName: exam.name, awarded, skipped };
    });
  }
}

@Injectable()
export class FinanceExpensesService {
  constructor(private prisma: PrismaService) {}

  // Prisma DateTime rejects bare YYYY-MM-DD strings ("premature end of input -
  // expected ISO-8601"). Normalize centrally so every caller (portal create,
  // legacy callers) is safe regardless of the incoming date shape.
  private static toIsoDateTime(date: unknown): string {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Date(`${date}T00:00:00.000Z`).toISOString();
    }
    return new Date(date as any).toISOString();
  }

  async createExpense(tenantId: string, dto: CreateExpenseDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.expense.create({
        data: { tenantId, ...dto, date: FinanceExpensesService.toIsoDateTime(dto.date), status: 'PENDING' },
      }),
    );
  }

  async listExpenses(tenantId: string, status?: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.expense.findMany({
        where: { tenantId, ...(status ? { status: status as any } : {}) },
        include: { category: true },
        orderBy: { date: 'desc' },
      }),
    );
  }

  async approveExpense(tenantId: string, userId: string, id: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.expense.update({ where: { id }, data: { status: 'APPROVED', approvedBy: userId } }),
    );
  }

  async rejectExpense(tenantId: string, id: string, _reason?: string) {
    // NOTE: _reason is accepted (and validated non-empty upstream) but not persisted:
    // the Expense model has no rejection-reason column. A follow-up migration can
    // add one; until then the reason is acknowledged by the API and shown no-where.
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.expense.update({ where: { id }, data: { status: 'REJECTED' } }),
    );
  }

  async updateExpense(
    tenantId: string,
    id: string,
    dto: { categoryId?: string; amount?: number; currency?: string; date?: string; vendor?: string; description?: string },
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.expense.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Expense not found');
      if (existing.status !== 'PENDING') {
        throw new BadRequestException('Only pending expenses can be edited');
      }
      const patch: any = { ...dto };
      if (patch.date) patch.date = FinanceExpensesService.toIsoDateTime(patch.date);
      return tx.expense.update({ where: { id }, data: patch });
    });
  }

  async deleteExpense(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.expense.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Expense not found');
      if (existing.status !== 'PENDING') {
        throw new BadRequestException('Only pending expenses can be deleted');
      }
      return tx.expense.delete({ where: { id } });
    });
  }

  async payExpense(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.expense.update({ where: { id }, data: { status: 'PAID' } }),
    );
  }

  async createRefund(tenantId: string, dto: CreateRefundDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.refundRequest.create({ data: { tenantId, ...dto, status: 'PENDING' } }),
    );
  }

  async listRefunds(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.refundRequest.findMany({
        where: { tenantId },
        include: { payment: true },
        orderBy: { id: 'desc' },
      }),
    );
  }

  async processRefund(tenantId: string, userId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const refund = await tx.refundRequest.findFirst({ where: { id, tenantId } });
      if (!refund) throw new NotFoundException('Refund request not found');
      await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUNDED' } });
      return tx.refundRequest.update({ where: { id }, data: { status: 'PROCESSED', approvedBy: userId, processedAt: new Date() } });
    });
  }
}

@Injectable()
export class FinanceCashService {
  constructor(private prisma: PrismaService) {}

  async createAccount(tenantId: string, dto: CreateAccountDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.financialAccount.create({ data: { tenantId, ...dto, type: dto.type as 'CASH' | 'BANK' } }),
    );
  }

  async listAccounts(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.financialAccount.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    );
  }

  async recordTransaction(tenantId: string, dto: RecordTransactionDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.financialTransaction.create({ data: { tenantId, ...dto } }),
    );
  }

  async listTransactions(tenantId: string, accountId?: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.financialTransaction.findMany({
        where: { tenantId, ...(accountId ? { accountId } : {}) },
        orderBy: { occurredAt: 'desc' },
      }),
    );
  }

  async listClosings(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.dailyCashClosing.findMany({
        where: { tenantId },
        include: { account: { select: { name: true } } },
        orderBy: { date: 'desc' },
      }),
    );
  }

  async getExpectedCash(tenantId: string, accountId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const account = await tx.financialAccount.findFirst({ where: { id: accountId, tenantId } });
      if (!account) throw new NotFoundException('Account not found');
      const transactions = await tx.financialTransaction.findMany({ where: { tenantId, accountId } });
      const credits = transactions.filter((t) => t.type === 'CREDIT').reduce((s, t) => s + Number(t.amount), 0);
      const debits = transactions.filter((t) => t.type === 'DEBIT').reduce((s, t) => s + Number(t.amount), 0);
      // Mirrors dailyClosing math exactly so the modal preview matches the stored variance.
      return Math.round((credits - debits) * 100) / 100;
    });
  }

  async dailyClosing(tenantId: string, userId: string, dto: DailyClosingDto & { notes?: string }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const account = await tx.financialAccount.findFirst({ where: { id: dto.accountId, tenantId } });
      if (!account) throw new NotFoundException('Account not found');
      const parsed = new Date(dto.date);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid closing date');
      // NOTE: dto.notes is accepted (modal requires it on discrepancy) but not persisted:
      // DailyCashClosing has no notes column. A follow-up migration can add one.
      const transactions = await tx.financialTransaction.findMany({ where: { tenantId, accountId: dto.accountId } });
      const credits = transactions.filter((t) => t.type === 'CREDIT').reduce((s, t) => s + Number(t.amount), 0);
      const debits = transactions.filter((t) => t.type === 'DEBIT').reduce((s, t) => s + Number(t.amount), 0);
      const closing = credits - debits;
      const discrepancy = Math.round((dto.countedAmount - closing) * 100) / 100;
      try {
        return await tx.dailyCashClosing.create({
          data: {
            tenantId,
            accountId: dto.accountId,
            date: parsed,
            openingAmount: 0,
            closingAmount: closing,
            countedAmount: dto.countedAmount,
            discrepancy,
            closedBy: userId,
          },
        });
      } catch (e: any) {
        // @@unique([tenantId, accountId, date]) — one close per account per day.
        if (e?.code === 'P2002') {
          throw new BadRequestException('A closing already exists for this account and date');
        }
        throw e;
      }
    });
  }

  /**
   * Internal fund transfer as a paired DEBIT (from) + CREDIT (to) sharing one
   * `XFER:<uuid>` token in referenceType, so existing balance math stays exact.
   * No schema change: notes/recordedBy have no columns and are accepted-but-unpersisted.
   */
  async transferFunds(
    tenantId: string,
    _userId: string,
    dto: { fromAccountId: string; toAccountId: string; amount: number; reference?: string; notes?: string },
  ) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('Transfer must move funds between two different accounts');
    }
    if (!(dto.amount > 0)) throw new BadRequestException('Transfer amount must be greater than zero');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [from, to] = await Promise.all([
        tx.financialAccount.findFirst({ where: { id: dto.fromAccountId, tenantId } }),
        tx.financialAccount.findFirst({ where: { id: dto.toAccountId, tenantId } }),
      ]);
      if (!from || !to) throw new NotFoundException('Account not found');
      const token = `XFER:${randomUUID()}`;
      const reference = dto.reference?.trim() || null;
      const occurredAt = new Date();
      const [debit, credit] = await Promise.all([
        tx.financialTransaction.create({
          data: { tenantId, accountId: from.id, type: 'DEBIT', amount: dto.amount, reference, referenceType: token, occurredAt },
        }),
        tx.financialTransaction.create({
          data: { tenantId, accountId: to.id, type: 'CREDIT', amount: dto.amount, reference, referenceType: token, occurredAt },
        }),
      ]);
      return {
        id: token,
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: dto.amount,
        reference,
        debitId: (debit as any).id,
        creditId: (credit as any).id,
      };
    });
  }

  async createReconciliation(tenantId: string, userId: string, dto: BankReconciliationDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.bankReconciliation.create({ data: { tenantId, ...dto, statementDate: new Date(dto.statementDate), reconciledBy: userId } }),
    );
  }
}

@Injectable()
export class FinanceControlsService {
  constructor(private prisma: PrismaService) {}

  async createPeriod(tenantId: string, dto: CreatePeriodDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('startDate/endDate must be valid dates');
    }
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException('startDate must not be after endDate');
    }
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.financialPeriod.create({
        data: { tenantId, name: dto.name, startDate: start, endDate: end },
      }),
    );
  }

  async listPeriods(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.financialPeriod.findMany({ where: { tenantId }, orderBy: { startDate: 'desc' } }),
    );
  }

  async closePeriod(tenantId: string, userId: string, id: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.financialPeriod.update({ where: { id }, data: { isClosed: true, closedBy: userId, closedAt: new Date() } }),
    );
  }

  async createPaymentMethod(tenantId: string, dto: CreatePaymentMethodDto) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.financialPaymentMethod.create({ data: { tenantId, ...dto } }),
    );
  }

  async listPaymentMethods(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.financialPaymentMethod.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    );
  }

  async listAuditLogs(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, (tx) =>
      tx.financialAuditLog.findMany({ where: { tenantId }, orderBy: { performedAt: 'desc' }, take: 200 }),
    );
  }

  // --- Period lock/unlock (closePeriod already existed; unlock is new) ---
  async setPeriodLock(tenantId: string, userId: string, id: string, locked: boolean) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const period = await tx.financialPeriod.findFirst({ where: { id, tenantId } });
      if (!period) throw new NotFoundException('Financial period not found');
      if (locked && period.isClosed) throw new BadRequestException('Period is already locked');
      if (!locked && !period.isClosed) throw new BadRequestException('Period is already open');
      const updated = await tx.financialPeriod.update({
        where: { id },
        data: locked
          ? { isClosed: true, closedBy: userId, closedAt: new Date() }
          : { isClosed: false, closedBy: null, closedAt: null },
      });
      return { id: updated.id, isClosed: updated.isClosed };
    });
  }

  // --- Payment channel controls (isActive + receipt-display linkage) ---
  async setMethodActive(tenantId: string, id: string, isActive: boolean) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const method = await tx.financialPaymentMethod.findFirst({ where: { id, tenantId } });
      if (!method) throw new NotFoundException('Payment method not found');
      const updated = await tx.financialPaymentMethod.update({ where: { id }, data: { isActive } });
      return { id: updated.id, isActive: updated.isActive };
    });
  }

  async setMethodDetails(tenantId: string, id: string, dto: { accountName?: string; accountNumber?: string }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const method = await tx.financialPaymentMethod.findFirst({ where: { id, tenantId } });
      if (!method) throw new NotFoundException('Payment method not found');
      const updated = await tx.financialPaymentMethod.update({
        where: { id },
        data: {
          ...(dto.accountName !== undefined ? { accountName: dto.accountName || null } : {}),
          ...(dto.accountNumber !== undefined ? { accountNumber: dto.accountNumber || null } : {}),
        },
      });
      return { id: updated.id, accountName: updated.accountName ?? null, accountNumber: updated.accountNumber ?? null };
    });
  }

  // --- Approval thresholds (approverRole constrained to real role slugs) ---
  private async assertRoleSlug(tx: any, tenantId: string, slug: string) {
    const roles = await tx.role.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
      select: { slug: true },
    });
    if (!(roles as any[]).some((r) => r.slug === slug)) {
      throw new BadRequestException(`Unknown role: ${slug}`);
    }
  }

  private mapThreshold(r: any) {
    return {
      id: r.id,
      module: r.module,
      threshold: Number(r.threshold ?? 0),
      approverRole: r.approverRole,
      isActive: r.isActive,
    };
  }

  async listThresholds(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.approvalThreshold.findMany({ where: { tenantId }, orderBy: { module: 'asc' } });
      return rows.map((r: any) => this.mapThreshold(r));
    });
  }

  async createThreshold(tenantId: string, dto: { module: string; threshold: number; approverRole: string }) {
    const amount = Number(dto.threshold);
    if (!dto.module?.trim()) throw new BadRequestException('Module is required');
    if (!(Number.isFinite(amount) && amount >= 0)) throw new BadRequestException('Threshold must be >= 0');
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.assertRoleSlug(tx, tenantId, dto.approverRole);
      const created = await tx.approvalThreshold.create({
        data: { tenantId, module: dto.module.trim(), threshold: amount, approverRole: dto.approverRole },
      });
      return this.mapThreshold(created);
    });
  }

  async updateThreshold(tenantId: string, id: string, dto: { module?: string; threshold?: number; approverRole?: string; isActive?: boolean }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.approvalThreshold.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Approval threshold not found');
      if (dto.threshold !== undefined && !(Number.isFinite(Number(dto.threshold)) && Number(dto.threshold) >= 0)) {
        throw new BadRequestException('Threshold must be >= 0');
      }
      if (dto.approverRole !== undefined) await this.assertRoleSlug(tx, tenantId, dto.approverRole);
      const updated = await tx.approvalThreshold.update({
        where: { id },
        data: {
          ...(dto.module !== undefined ? { module: dto.module.trim() } : {}),
          ...(dto.threshold !== undefined ? { threshold: Number(dto.threshold) } : {}),
          ...(dto.approverRole !== undefined ? { approverRole: dto.approverRole } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      return this.mapThreshold(updated);
    });
  }

  async deleteThreshold(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.approvalThreshold.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Approval threshold not found');
      await tx.approvalThreshold.delete({ where: { id } });
      return { id, deleted: true };
    });
  }

  // --- Financial settings (tenant currency + finance JSON bag) ---
  private financeDefaults() {
    return { receiptPrefix: 'SCH-REC-', voucherPrefix: 'SCH-EXP-', graceDays: 7 };
  }

  async getFinanceSettings(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const bag = ((tenant as any)?.settings as any)?.finance ?? {};
      return {
        currency: (tenant as any)?.currencyCode ?? 'SDG',
        ...this.financeDefaults(),
        ...(typeof bag === 'object' && bag ? bag : {}),
      };
    });
  }

  async updateFinanceSettings(
    tenantId: string,
    dto: { currency?: string; receiptPrefix?: string; voucherPrefix?: string; graceDays?: number },
  ) {
    if (dto.currency !== undefined && !/^[A-Z]{3}$/.test(dto.currency)) {
      throw new BadRequestException('Currency must be a 3-letter code');
    }
    if (dto.graceDays !== undefined && !(Number.isInteger(Number(dto.graceDays)) && Number(dto.graceDays) >= 0)) {
      throw new BadRequestException('Grace days must be a non-negative integer');
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const current = ((tenant as any)?.settings as any) ?? {};
      const finance = {
        ...this.financeDefaults(),
        ...((typeof current.finance === 'object' && current.finance) ? current.finance : {}),
        ...(dto.receiptPrefix !== undefined ? { receiptPrefix: dto.receiptPrefix } : {}),
        ...(dto.voucherPrefix !== undefined ? { voucherPrefix: dto.voucherPrefix } : {}),
        ...(dto.graceDays !== undefined ? { graceDays: Number(dto.graceDays) } : {}),
      };
      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          ...(dto.currency !== undefined ? { currencyCode: dto.currency } : {}),
          settings: { ...current, finance },
        },
      });
      const bag = ((updated as any)?.settings as any)?.finance ?? {};
      return {
        currency: (updated as any)?.currencyCode ?? 'SDG',
        ...this.financeDefaults(),
        ...(typeof bag === 'object' && bag ? bag : {}),
      };
    });
  }
}

@Injectable()
export class FinanceDashboardService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async mintSocketTicket(tenantId: string, userId: string) {
    return this.prisma.withTenantRead(tenantId, async () => {
      const ticket = await this.jwt.signAsync(
        { sub: userId, tenantId },
        { expiresIn: '600s', audience: 'socket' },
      );
      return { ticket, expiresIn: 600 };
    });
  }

  async getStats(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const [payments, lastMonth, expenses, payroll, students, teachers, tenantRow, recentPayments, recentExpenses, recentPayouts] = await Promise.all([
        tx.payment.aggregate({ where: { tenantId, status: 'COMPLETED' }, _sum: { amount: true } }),
        tx.payment.aggregate({
          where: { tenantId, status: 'COMPLETED', paidAt: { gte: lastMonthStart, lt: monthStart } },
          _sum: { amount: true },
        }),
        tx.expense.aggregate({ where: { tenantId, status: { in: ['APPROVED', 'PAID'] } }, _sum: { amount: true } }),
        tx.salaryPayout.aggregate({ where: { tenantId, status: 'PAID' }, _sum: { netAmount: true } }),
        tx.student.count({ where: { tenantId, status: 'ACTIVE' } }),
        tx.teacher.count({ where: { tenantId, status: 'ACTIVE' } }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } }),
        tx.payment.findMany({
          where: { tenantId, status: 'COMPLETED' },
          include: { student: { select: { firstName: true, lastName: true } } },
          orderBy: { paidAt: 'desc' },
          take: 10,
        }),
        tx.expense.findMany({
          where: { tenantId, status: { in: ['APPROVED', 'PAID'] } },
          include: { category: { select: { name: true } } },
          orderBy: { date: 'desc' },
          take: 10,
        }),
        tx.salaryPayout.findMany({
          where: { tenantId, status: 'PAID' },
          include: { user: { select: { firstName: true, lastName: true } } },
          orderBy: { paidAt: 'desc' },
          take: 10,
        }),
      ]);
      const collected = Number((payments as any)._sum.amount ?? 0);
      const prevCollected = Number((lastMonth as any)._sum.amount ?? 0);
      const expensesTotal = Number((expenses as any)._sum.amount ?? 0);
      const payrollTotal = Math.round(Number((payroll as any)._sum.netAmount ?? 0) * 100) / 100;
      const outflows = Math.round((expensesTotal + payrollTotal) * 100) / 100;

      const activity: Array<{ type: string; title: string; amount: number; method: string; at: string | null }> = [];
      for (const p of recentPayments as any[]) {
        activity.push({
          type: 'COLLECTION',
          title: p.student ? `${p.student.firstName} ${p.student.lastName ?? ''}`.trim() : 'Tuition collection',
          amount: Math.round(Number(p.amount ?? 0) * 100) / 100,
          method: p.method,
          at: p.paidAt ? new Date(p.paidAt).toISOString() : null,
        });
      }
      for (const e of recentExpenses as any[]) {
        activity.push({
          type: 'EXPENSE',
          title: [e.category?.name, e.vendor || e.description].filter(Boolean).join(' · ') || 'Expense',
          amount: -Math.round(Number(e.amount ?? 0) * 100) / 100,
          method: '—',
          at: e.date ? new Date(e.date).toISOString() : null,
        });
      }
      for (const p of recentPayouts as any[]) {
        activity.push({
          type: 'PAYROLL',
          title: p.user ? `Salary — ${p.user.firstName} ${p.user.lastName ?? ''}`.trim() : 'Salary payout',
          amount: -Math.round(Number(p.netAmount ?? 0) * 100) / 100,
          method: p.paymentMethod ?? '—',
          at: p.paidAt ? new Date(p.paidAt).toISOString() : null,
        });
      }
      activity.sort((a, b) => (a.at ?? '') < (b.at ?? '') ? 1 : -1);

      return {
        tenant: { id: tenantId, name: (tenantRow as any)?.name ?? '' },
        totalCollected: collected,
        expenses: expensesTotal,
        payroll: payrollTotal,
        outflows,
        netCashFlow: Math.round((collected - outflows) * 100) / 100,
        collectionsLastMonth: prevCollected,
        collectionsChangePct: prevCollected > 0 ? Math.round(((collected - prevCollected) / prevCollected) * 10000) / 100 : null,
        totalStudents: students,
        totalTeachers: teachers,
        recentActivity: activity.slice(0, 10),
      };
    });
  }
}

