import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildInstallmentPlan, normalizeInstallmentCount } from './installment-math';
import {
  FinancePaymentsService, FinanceDiscountsService,
  FinanceExpensesService, FinanceCashService, FinanceControlsService,
  FinanceDashboardService, FinanceCategoriesService,
} from './finance.service';
import { FinancePayrollService } from './finance-payroll.service';
import { RealtimeGateway, financeRoom } from '../realtime/realtime.gateway';

const num = (v: unknown): number => Number(v ?? 0);
const lower = (v: unknown): string => String(v ?? '').toLowerCase();
const round2 = (v: number): number => Math.round(v * 100) / 100;

@Injectable()
export class FinancePortalService {
  constructor(
    private prisma: PrismaService,
    private payments: FinancePaymentsService,
    private discounts: FinanceDiscountsService,
    private expenses: FinanceExpensesService,
    private cash: FinanceCashService,
    private controls: FinanceControlsService,
    private dashboard: FinanceDashboardService,
    private categories: FinanceCategoriesService,
    private payroll: FinancePayrollService,
    private realtime: RealtimeGateway,
  ) {}

  private readonly logger = new Logger(FinancePortalService.name);

  private fullName(s: { firstName: string; lastName?: string | null }): string {
    return `${s.firstName} ${s.lastName ?? ''}`.trim();
  }

  private async resolveStudentId(tx: any, tenantId: string, fullName: string): Promise<string> {
    const parts = fullName.trim().split(/\s+/);
    const first = parts[0];
    const last = parts.slice(1).join(' ');
    const student = await tx.student.findFirst({
      where: {
        tenantId,
        firstName: { equals: first, mode: 'insensitive' },
        ...(last ? { lastName: { equals: last, mode: 'insensitive' } } : {}),
      },
      select: { id: true },
    });
    if (!student) throw new NotFoundException(`Student "${fullName}" not found`);
    return student.id;
  }

  // SchoolClassGrade enum -> int, so we can compare against Student.grade (Int?).
  private static readonly GRADE_ORDINAL: Record<string, number> = {
    FIRST: 1, SECOND: 2, THIRD: 3, SIXTH: 6, SEVENTH: 7, EIGHTH: 8, NINTH: 9,
  };

  private gradeOrdinal(enumVal?: string | null): number | null {
    if (!enumVal) return null;
    return FinancePortalService.GRADE_ORDINAL[String(enumVal).toUpperCase()] ?? null;
  }

  // Best-match a student to an active fee structure for the latest academic year.
  // Exact level+grade wins; otherwise level-only (grade null) matches; otherwise null.
  private async resolveStructureForStudent(tx: any, tenantId: string, student: any, academicYearId: string) {
    const candidates = await tx.feeStructure.findMany({
      where: { tenantId, academicYearId, isActive: true },
      include: { installments: { orderBy: { installmentNo: 'asc' } } },
    });
    const level = student.educationLevel ?? null;
    const gradeInt = student.grade ?? null;

    const levelMatch = (s: any) => !s.educationLevel || s.educationLevel === level;
    const gradeMatch = (s: any) => {
      const ord = this.gradeOrdinal(s.grade);
      return ord === null || gradeInt === null || ord === gradeInt;
    };

    const exact = candidates.filter((s: any) => levelMatch(s) && s.grade && gradeMatch(s));
    const levelOnly = candidates.filter((s: any) => levelMatch(s) && !s.grade);
    const pick = exact[0] ?? levelOnly[0] ?? null;
    return pick;
  }

  private async latestAcademicYear(tx: any, tenantId: string) {
    const year = await tx.academicYear.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    if (!year) throw new NotFoundException('No academic year configured');
    return year;
  }

  private classNameOf(s: any): string {
    return s?.className ?? s?.schoolClass?.className ?? '';
  }

  async listCategories(tenantId: string) {
    const cats = await this.categories.listFeeCategories(tenantId);
    return cats.map((c: any) => ({ id: c.id, name: c.name, description: c.description ?? '', active: true }));
  }

  async createCategory(tenantId: string, dto: { name: string; description?: string }) {
    const c: any = await this.categories.createFeeCategory(tenantId, dto);
    return { id: c.id, name: c.name, description: c.description ?? '', active: true };
  }

  async updateCategory(tenantId: string, id: string, dto: { name?: string; description?: string }) {
    const c: any = await this.categories.updateFeeCategory(tenantId, id, dto);
    return { id: c.id, name: c.name, description: c.description ?? '', active: true };
  }

  async deleteCategory(tenantId: string, id: string) {
    return this.categories.deleteFeeCategory(tenantId, id);
  }

  private feeFrequency(f?: string): 'ANNUAL' | 'PER_TERM' {
    const map: Record<string, 'ANNUAL' | 'PER_TERM'> = {
      annual: 'ANNUAL', per_term: 'PER_TERM', perterm: 'PER_TERM', per_term_only: 'PER_TERM',
      term: 'PER_TERM', termly: 'PER_TERM',
    };
    return map[lower(f)] ?? 'ANNUAL';
  }

  async listStructures(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.feeStructure.findMany({
        where: { tenantId },
        include: { installments: { orderBy: { installmentNo: 'asc' } } },
        orderBy: { id: 'desc' },
        take: 300,
      });
      return rows.map((s: any) => ({
        id: s.id,
        categoryId: s.categoryId ?? '',
        name: s.name ?? '',
        tuitionFee: num(s.tuitionFee),
        registrationFee: num(s.registrationFee),
        currencyCode: s.currencyCode,
        frequency: lower(s.frequency),
        educationLevel: s.educationLevel ?? '',
        grade: s.grade ?? '',
        installmentCount: s.installments?.length || s.installmentCount || 1,
        installmentDueDates: (s.installments ?? []).map((i: any) => new Date(i.dueDate).toISOString()),
        installments: (s.installments ?? []).map((i: any) => ({
          installmentNo: i.installmentNo,
          amount: num(i.amount),
          dueDate: new Date(i.dueDate).toISOString(),
        })),
        isActive: s.isActive,
        active: s.isActive,
      }));
});
  }

  async listAssignableStudents(
    tenantId: string,
    page = 1,
    pageSize = 50,
    q?: string,
  ) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const or: any[] = q
        ? [
            { firstName: { contains: q, mode: 'insensitive' as const } },
            { lastName: { contains: q, mode: 'insensitive' as const } },
            { roleNumber: { contains: q, mode: 'insensitive' as const } },
          ]
        : [];
      // A pasted UUID resolves directly so the cashier can bind an exact student.
      if (q && /^[0-9a-f-]{32,36}$/i.test(q.trim())) {
        or.push({ id: { equals: q.trim() } });
      }
      const where = { tenantId, ...(or.length ? { OR: or } : {}) };
      const [data, total] = await Promise.all([
        tx.student.findMany({
          where,
          select: { id: true, firstName: true, lastName: true, educationLevel: true, grade: true, roleNumber: true },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.student.count({ where }),
      ]);
      const titleCase = (s: string | null | undefined) =>
        s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
      return {
        data: data.map((s) => {
          const scope = [
            titleCase(s.educationLevel ?? undefined),
            s.grade != null ? `Grade ${s.grade}` : '',
          ].filter(Boolean).join(', ');
          return {
            id: s.id,
            name: this.fullName(s),
            // Disambiguating label for pickers: "Amina Khalid — Secondary, Grade 3".
            // Additive only — existing consumers of `name` are untouched.
            displayLabel: scope ? `${this.fullName(s)} — ${scope}` : this.fullName(s),
            firstName: s.firstName,
            lastName: s.lastName,
            educationLevel: s.educationLevel,
            grade: s.grade,
            roleNumber: (s as any).roleNumber ?? '',
          };
        }),
        total,
        page,
        pageSize,
      };
    });
  }

  async listAssignableClasses(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.schoolClass.findMany({
        where: { tenantId },
        select: {
          id: true,
          className: true,
          educationLevel: true,
          grade: true,
          _count: { select: { enrollments: true } },
        },
        orderBy: [{ educationLevel: 'asc' }, { grade: 'asc' }, { className: 'asc' }],
      });
      return rows.map((r) => ({
        id: r.id,
        className: r.className,
        educationLevel: r.educationLevel,
        grade: r.grade,
        studentCount: r._count.enrollments,
      }));
    });
  }

  async listAcademicYears(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      return tx.academicYear.findMany({
        where: { tenantId },
        select: { id: true, name: true, startsOn: true, endsOn: true, isCurrent: true },
        orderBy: { startsOn: 'desc' },
      });
    });
  }

  async createStructure(
    tenantId: string,
    dto: {
      name: string;
      categoryId?: string;
      tuitionFee: number;
      registrationFee?: number;
      frequency?: string;
      educationLevel?: string;
      grade?: string;
      installmentCount?: number;
      installmentDueDates?: string[];
    },
  ) {
    const installmentCount = normalizeInstallmentCount(dto.installmentCount);
    const dueDates = dto.installmentDueDates ?? [];
    if (dueDates.length !== installmentCount) {
      throw new BadRequestException(
        `installmentDueDates must contain exactly ${installmentCount} date(s) to match installmentCount`,
      );
    }
    const sorted = [...dueDates].sort();
    if (dueDates.some((d, i) => d !== sorted[i])) {
      throw new BadRequestException('installmentDueDates must be in ascending order');
    }

    const plan = buildInstallmentPlan({
      grossAmount: dto.tuitionFee,
      installmentCount,
      dueDates,
    });

    return this.prisma.withTenant(tenantId, async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
      if (!year) throw new NotFoundException('No academic year configured');
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const structure = await tx.feeStructure.create({
        data: {
          tenantId,
          academicYearId: year.id,
          name: dto.name.trim(),
          categoryId: dto.categoryId || null,
          tuitionFee: dto.tuitionFee,
          registrationFee: dto.registrationFee ?? 0,
          currencyCode: tenant?.currencyCode ?? 'SDG',
          frequency: this.feeFrequency(dto.frequency),
          installmentCount,
          installments: {
            create: plan.map((p) => ({
              installmentNo: p.installmentNumber,
              amount: p.amount,
              dueDate: new Date(p.dueDate ?? dueDates[p.installmentNumber - 1]),
            })),
          },
          ...(dto.educationLevel ? { educationLevel: dto.educationLevel as any } : {}),
          ...(dto.grade ? { grade: dto.grade as any } : {}),
        },
        include: { installments: { orderBy: { installmentNo: 'asc' } } },
      });
      return this.mapStructure(structure);
    });
  }

  private mapStructure(s: any) {
    return {
      id: s.id,
      categoryId: s.categoryId ?? '',
      name: s.name ?? '',
      tuitionFee: num(s.tuitionFee),
      registrationFee: num(s.registrationFee),
      currencyCode: s.currencyCode,
      frequency: lower(s.frequency),
      educationLevel: s.educationLevel ?? '',
      grade: s.grade ?? '',
      installmentCount: s.installments?.length || s.installmentCount || 1,
      installmentDueDates: (s.installments ?? []).map((i: any) => new Date(i.dueDate).toISOString()),
      installments: (s.installments ?? []).map((i: any) => ({
        installmentNo: i.installmentNo,
        amount: num(i.amount),
        dueDate: new Date(i.dueDate).toISOString(),
      })),
      isActive: s.isActive,
      active: s.isActive,
    };
  }

  async updateStructure(tenantId: string, id: string, dto: {
    name?: string;
    categoryId?: string;
    tuitionFee?: number;
    registrationFee?: number;
    frequency?: string;
    educationLevel?: string;
    grade?: string;
    installmentCount?: number;
    installmentDueDates?: string[];
  }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.feeStructure.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Fee structure not found');

      const data: any = {};
      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.categoryId !== undefined) data.categoryId = dto.categoryId || null;
      if (dto.tuitionFee !== undefined) data.tuitionFee = dto.tuitionFee;
      if (dto.registrationFee !== undefined) data.registrationFee = dto.registrationFee;
      if (dto.frequency !== undefined) data.frequency = this.feeFrequency(dto.frequency);
      if (dto.educationLevel !== undefined) data.educationLevel = dto.educationLevel || null;
      if (dto.grade !== undefined) data.grade = dto.grade || null;

      const touchesSchedule =
        dto.installmentCount !== undefined || dto.installmentDueDates !== undefined || dto.tuitionFee !== undefined;
      if (touchesSchedule) {
        const count = normalizeInstallmentCount(dto.installmentCount ?? existing.installmentCount);
        const current: any[] = await tx.feeInstallment.findMany({
          where: { tenantId, feeStructureId: id },
          orderBy: { installmentNo: 'asc' },
        });
        const dates =
          dto.installmentDueDates ?? current.map((i: any) => new Date(i.dueDate).toISOString().slice(0, 10));
        if (dates.length !== count) {
          throw new BadRequestException(
            `installmentDueDates must contain exactly ${count} date(s) to match installmentCount`,
          );
        }
        const ordered = [...dates].sort();
        if (dates.some((d, i) => d !== ordered[i])) {
          throw new BadRequestException('installmentDueDates must be in ascending order');
        }
        const tuition = dto.tuitionFee ?? num(existing.tuitionFee);
        data.installmentCount = count;
        await tx.feeInstallment.deleteMany({ where: { tenantId, feeStructureId: id } });
        const plan = buildInstallmentPlan({ grossAmount: tuition, installmentCount: count, dueDates: dates });
        await tx.feeInstallment.createMany({
          data: plan.map((p) => ({
            tenantId,
            feeStructureId: id,
            installmentNo: p.installmentNumber,
            amount: p.amount,
            dueDate: new Date(p.dueDate ?? dates[p.installmentNumber - 1]),
          })),
        });
      }

      const updated = await tx.feeStructure.update({
        where: { id },
        data,
        include: { installments: { orderBy: { installmentNo: 'asc' } } },
      });
      return this.mapStructure(updated);
    });
  }

  async archiveStructure(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.feeStructure.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Fee structure not found');
      if (existing.isActive === false) return { id, archived: true, alreadyArchived: true };
      await tx.feeStructure.update({ where: { id }, data: { isActive: false } });
      return { id, archived: true };
    });
  }

  async unarchiveStructure(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.feeStructure.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Fee structure not found');
      if (existing.isActive !== false) return { id, active: true, alreadyActive: true };
      await tx.feeStructure.update({ where: { id }, data: { isActive: true } });
      return { id, active: true };
    });
  }

  async deleteStructure(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.feeStructure.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Fee structure not found');
      await tx.feeInstallment.deleteMany({ where: { tenantId, feeStructureId: id } });
      await tx.feeStructure.delete({ where: { id } });
      return { id, deleted: true };
    });
  }

  async listPayments(tenantId: string, status?: string, limit?: number) {
    const requested = Number.isFinite(limit) ? Math.trunc(limit as number) : 200;
    const take = requested === 0 ? undefined : Math.min(Math.max(requested, 1), 5000);
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const payments = await tx.payment.findMany({
        where: { tenantId, ...(status ? { status: status.toUpperCase() as any } : {}) },
        include: {
          student: {
            select: {
              id: true, firstName: true, lastName: true, roleNumber: true,
              educationLevel: true, grade: true,
            },
          },
          allocations: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { paidAt: 'desc' },
        ...(take ? { take } : {}),
      });

      const studentIds = [...new Set(payments.map((p: any) => p.studentId))];
      const schedules = await this.buildSchedules(tx, tenantId, studentIds);

      return payments.map((p: any) => {
        const sched = schedules.get(p.studentId);
        const allocs = p.allocations ?? [];
        const first = allocs[0] ?? null;
        const targetLabel = this.allocationLabel(allocs, sched?.totalFee ?? 0, sched?.totalPaid ?? 0);
        
        // Determine if this is the final payment on the target installment
        const primaryAlloc = allocs[0] ?? null;
        const targetInstallmentNo =
          primaryAlloc?.kind === 'INSTALLMENT' ? primaryAlloc.installmentNo : null;
        const isFinalPaymentOnInstallment = targetInstallmentNo
          ? (sched?.installments?.find((i: any) => i.no === targetInstallmentNo)?.complete ?? false)
          : false;

        // Per-invoice progress: if single installment target, compute progress against that installment
        // For lump-sum, show overall progress; for registration, show registration progress
        let installmentProgress: { invoiceAmount: number; amountPaidToDate: number; percent: number } | null = null;
        // Task 5: this payment's effect — before / contributed / after for the
        // target installment, so the row can show opening vs part vs final.
        let installmentEffect: {
          contributed: number; amountBefore: number; amountAfter: number;
          isOpening: boolean; isFinal: boolean;
        } | null = null;
        if (primaryAlloc?.kind === 'INSTALLMENT' && primaryAlloc.installmentNo) {
          const inst = sched?.installments?.find((i: any) => i.no === primaryAlloc.installmentNo);
          if (inst) {
            installmentProgress = {
              invoiceAmount: num(inst.amount),
              amountPaidToDate: num(inst.paid),
              percent:
                num(inst.amount) > 0
                  ? Math.min(100, Math.round((num(inst.paid) / num(inst.amount)) * 100))
                  : 100,
            };
            const eff = sched?.effects?.get(`${p.id}:${primaryAlloc.installmentNo}`);
            if (eff) {
              const target = num(inst.amount);
              installmentEffect = {
                contributed: num(eff.contributed),
                amountBefore: num(eff.before),
                amountAfter: num(eff.after),
                isOpening: num(eff.before) <= 0.005,
                // Per-payment finality: this payment's slice closed the
                // installment. (The top-level isFinalPaymentOnInstallment flag
                // is schedule-wide and stays true for earlier rows too.)
                isFinal: num(eff.after) >= target - 0.005 && num(eff.before) < target - 0.005,
              };
            }
          }
        } else if (primaryAlloc?.kind === 'REGISTRATION') {
          const regFee = sched?.registrationFee ?? 0;
          const regPaid = sched?.registrationPaid ?? 0;
          installmentProgress = {
            invoiceAmount: num(sched?.registrationFee ?? 0),
            amountPaidToDate: num(sched?.registrationPaid ?? 0),
            percent: regFee > 0 ? Math.min(100, Math.round((regPaid / regFee) * 100)) : 100,
          };
        } else if (primaryAlloc?.kind === 'TRANSPORT') {
          const transportFee = num(sched?.transportFee ?? 0);
          const transportPaid = num(sched?.transportPaid ?? 0);
          installmentProgress = {
            invoiceAmount: transportFee,
            amountPaidToDate: transportPaid,
            percent: transportFee > 0 ? Math.min(100, Math.round((transportPaid / transportFee) * 100)) : 100,
          };
        }

        return {
          id: p.id,
          studentId: p.studentId,
          studentName: p.student ? this.fullName(p.student) : '',
          roleNumber: p.student?.roleNumber ?? '',
          educationLevel: p.student?.educationLevel ?? '',
          grade: p.student?.grade ?? null,
          className: sched?.className ?? '',
          totalFee: sched?.totalFee ?? 0,
          amount: num(p.amount),
          currencyCode: p.currencyCode,
          method: lower(p.method),
          reference: p.paymentReference ?? undefined,
          allocationKind: first ? lower(first.kind) : 'lump_sum',
          allocationTarget: targetLabel,
          installmentNo: first?.installmentNo ?? null,
          installmentPaid: sched?.installments?.find((i: any) => i.no === first?.installmentNo)?.paid ?? 0,
          installmentAmount: sched?.installments?.find((i: any) => i.no === first?.installmentNo)?.amount ?? 0,
          balance: sched?.balance ?? 0,
          progress: sched?.progress ?? 0,
          status: sched?.status ?? 'on_track',
          daysLate: sched?.daysLate ?? 0,
          statusLabel: lower(p.status),
          paymentStatus: p.status,
          paidAt: new Date(p.paidAt).toISOString(),
          // Task 2: stable receipt-issue timestamp (does not move on reprint).
          createdAt: new Date(p.createdAt).toISOString(),
          isFinalPaymentOnInstallment,
          installmentProgress,
          installmentEffect,
        };
      });
    });
  }

  private allocationLabel(allocs: any[], totalFee?: number, priorPayments?: number): string {
    if (!allocs?.length) return 'Lump-Sum';

    // Collect all kinds and installment numbers
    const kinds = new Set<string>();
    const installmentNos = new Set<number>();

    for (const a of allocs) {
      kinds.add(a.kind);
      if (a.kind === 'INSTALLMENT') installmentNos.add(a.installmentNo ?? 0);
    }
    const totalAllocated = allocs.reduce((sum, a) => sum + num(a.amount), 0);

    // Case 1: Only LUMP_SUM kind. "Full Year" only when this payment settles
    // the balance outstanding before it; otherwise it is a partial lump-sum.
    // priorPayments includes this payment, so add it back to get the before-balance.
    if (kinds.has('LUMP_SUM') && kinds.size === 1) {
      const beforeBalance = (totalFee ?? 0) - (priorPayments ?? 0) + totalAllocated;
      if (totalAllocated >= beforeBalance - 0.005) return 'Lump-Sum (Full Year)';
      return 'Lump-Sum (Partial)';
    }

    // Case 2: Only REGISTRATION kind → Registration
    if (kinds.has('REGISTRATION') && kinds.size === 1) return 'Registration';

    // Case 2b: Only TRANSPORT kind → Transport
    if (kinds.has('TRANSPORT') && kinds.size === 1) return 'Transport';

    // Case 3: Only INSTALLMENT kind
    if (kinds.has('INSTALLMENT') && kinds.size === 1) {
      // All installment payments for the same installment number
      if (installmentNos.size === 1) {
        return `Installment #${Array.from(installmentNos)[0]}`;
      }

      // Multiple installment numbers — check if this fully settles the student's balance
      const outstanding = (totalFee ?? 0) - (priorPayments ?? 0) + totalAllocated;
      if (totalAllocated >= outstanding - 0.005) return 'Lump-Sum (Full Year)';
      return 'Multiple';
    }

    // Case 4: Mixed kinds or multiple installment numbers without full settlement → Multiple
    return 'Multiple';
  }

  // Compute the full billing schedule + running status for a set of students.
  private async buildSchedules(tx: any, tenantId: string, studentIds: string[]) {
    const map = new Map<string, any>();
    if (!studentIds.length) return map;

    const year = await tx.academicYear.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    const links = await tx.studentFeeStructure.findMany({
      where: { tenantId, studentId: { in: studentIds }, ...(year ? { academicYearId: year.id } : {}) },
      include: {
        feeStructure: { include: { installments: { orderBy: { installmentNo: 'asc' } } } },
        schoolClass: { select: { className: true } },
      },
    });

    const linkByStudent = new Map<string, any>(links.map((l: any) => [l.studentId, l]));

    // className from enrollment (fallback to fee-structure class)
    const enrollments = await tx.studentEnrollment.findMany({
      where: { tenantId, studentId: { in: studentIds }, status: 'ACTIVE', ...(year ? { academicYearId: year.id } : {}) },
      include: { schoolClass: { select: { className: true } } },
    });
    const classByStudent = new Map<string, string>(enrollments.map((e: any) => [e.studentId, e.schoolClass?.className ?? '']));

    // Students' level+grade, so an unassigned student can preview the fee
    // structure the school determined for their education level (proposed,
    // never persisted here — resolveStudentLink still creates the link at
    // save time).
    let students: any[] = [];
    try {
      students = (await tx.student?.findMany?.({
        where: { tenantId, id: { in: studentIds } },
        select: { id: true, educationLevel: true, grade: true },
      })) ?? [];
    } catch {
      students = [];
    }
    const studentById = new Map<string, any>((students ?? []).map((s: any) => [s.id, s]));

    const allocs = await tx.paymentAllocation.findMany({
      where: { tenantId, studentFeeStructureId: { in: links.map((l: any) => l.id) } },
      include: { payment: { select: { status: true } } },
    });
    const allocsByLink = new Map<string, any[]>();
    for (const a of allocs) {
      if (!allocsByLink.has(a.studentFeeStructureId)) allocsByLink.set(a.studentFeeStructureId, []);
      allocsByLink.get(a.studentFeeStructureId)!.push(a);
    }

    // Payment-time discounts narrow the same targets cash does. Discounts are
    // price reductions, not cash: they never un-apply (no REFUNDED coupling).
    const discountRows: any[] = (await tx.discountApplication?.findMany?.({
      where: { tenantId, studentFeeStructureId: { in: links.map((l: any) => l.id) } },
    })) ?? [];
    const discountsByLink = new Map<string, any[]>();
    for (const d of discountRows) {
      if (!discountsByLink.has(d.studentFeeStructureId)) discountsByLink.set(d.studentFeeStructureId, []);
      discountsByLink.get(d.studentFeeStructureId)!.push(d);
    }

    const now = new Date();
    for (const sid of studentIds) {
      const link = linkByStudent.get(sid);
      if (!link) {
        // No assignment yet — preview the school-determined structure for
        // this student's education level so the payment dialog can offer
        // installments 1..n and an amount instead of dead-ending.
        const pupil = studentById.get(sid);
        if (pupil && year) {
          const structure = await this.resolveStructureForStudent(tx, tenantId, pupil, year.id).catch((e: unknown) => {
            this.logger.warn(
              {
                event: 'fee_structure_resolution_failed',
                studentId: sid,
                educationLevel: pupil.educationLevel ?? null,
                grade: pupil.grade ?? null,
                academicYearId: year.id,
                reason: e instanceof Error ? e.message : String(e),
              },
              'Fee structure resolution failed; falling back to assigned:false',
            );
            return null;
          });
          if (structure) {
            const regFee = num(structure.registrationFee);
            const tuition = num(structure.tuitionFee);
            const totalFee = tuition + regFee;
            const installments = (structure.installments ?? []).map((fi: any) => {
              const due = new Date(fi.dueDate);
              const overdue = now > due && num(fi.amount) > 0.005;
              return {
                no: fi.installmentNo,
                amount: num(fi.amount),
                dueDate: due.toISOString(),
                paid: 0,
                complete: false,
                overdue,
                daysLate: overdue ? Math.floor((now.getTime() - due.getTime()) / 86400000) : 0,
              };
            });
            const currentTarget = installments.find((i: any) => !i.complete) ?? null;
            const anyOverdue = installments.find((i: any) => i.overdue) ?? null;
            map.set(sid, {
              assigned: true,
              proposed: true,
              className: classByStudent.get(sid) ?? '',
              studentFeeStructureId: null,
              feeStructureId: structure.id,
              totalFee,
              registrationFee: regFee,
              tuitionFee: tuition,
              transportFee: 0,
              transportPaid: 0,
              totalPaid: 0,
              registrationPaid: 0,
              lumpPaid: 0,
              balance: Math.max(0, totalFee),
              progress: 0,
              status: anyOverdue ? 'overdue' : 'on_track',
              daysLate: anyOverdue ? anyOverdue.daysLate : 0,
              frequency: lower(structure.frequency),
              installments,
              currentTarget,
            });
            continue;
          }
        }
        map.set(sid, {
          assigned: false, className: classByStudent.get(sid) ?? '',
          studentFeeStructureId: null, feeStructureId: null,
          totalFee: 0, registrationFee: 0, tuitionFee: 0, transportFee: 0, transportPaid: 0, totalPaid: 0,
          registrationPaid: 0, lumpPaid: 0, balance: 0,
          progress: 100, status: 'on_track', daysLate: 0, frequency: '',
          installments: [], currentTarget: null,
        });
        continue;
      }
      const structure = link.feeStructure;
      const regFee = num(structure.registrationFee);
      const tuition = num(structure.tuitionFee);
      const transportFee = num(link.transportFee);
      // Transport rides the same annual bill: it inflates the persisted
      // link.totalFee (tuition + registration), never replaces it.
      const totalFee = (num(link.totalFee) || tuition + regFee) + transportFee;

      const mine = allocsByLink.get(link.id) ?? [];
      const countable = mine.filter((a: any) => a.payment?.status !== 'REFUNDED');

      const appliedDiscounts = discountsByLink.get(link.id) ?? [];
      const discountedByNo = new Map<number, number>();
      let regDiscounted = 0;
      for (const d of appliedDiscounts) {
        if (d.targetKind === 'REGISTRATION') regDiscounted += num(d.amount);
        else if (d.targetKind === 'INSTALLMENT' && d.installmentNo != null) {
          discountedByNo.set(d.installmentNo, (discountedByNo.get(d.installmentNo) ?? 0) + num(d.amount));
        }
      }

      const regPaid = countable.filter((a: any) => a.kind === 'REGISTRATION')
        .reduce((s: number, a: any) => s + num(a.amount), 0);
      const lumpPaid = countable.filter((a: any) => a.kind === 'LUMP_SUM')
        .reduce((s: number, a: any) => s + num(a.amount), 0);
      const transportPaid = countable.filter((a: any) => a.kind === 'TRANSPORT')
        .reduce((s: number, a: any) => s + num(a.amount), 0);

      const installments = (structure.installments ?? []).map((fi: any) => {
        const paid = countable
          .filter((a: any) => a.kind === 'INSTALLMENT' && a.installmentNo === fi.installmentNo)
          .reduce((s: number, a: any) => s + num(a.amount), 0);
        const discounted = discountedByNo.get(fi.installmentNo) ?? 0;
        const settled = paid + discounted;
        const due = new Date(fi.dueDate);
        const overdue = now > due && settled < num(fi.amount) - 0.005;
        const daysLate = overdue ? Math.floor((now.getTime() - due.getTime()) / 86400000) : 0;
        return {
          no: fi.installmentNo,
          amount: num(fi.amount),
          dueDate: due.toISOString(),
          paid,
          discounted,
          complete: settled >= num(fi.amount) - 0.005,
          overdue,
          daysLate,
        };
      });

      // Task 5: per-payment effect on each installment. Walk allocations in
      // creation order so every payment knows the balance before it, what it
      // contributed, and the balance after it. Keyed `${paymentId}:${installmentNo}`.
      // REFUNDED payments are excluded via `countable`, matching `paid` above.
      const effects = new Map<string, { before: number; contributed: number; after: number }>();
      {
        const byNo = new Map<number, any[]>();
        for (const a of countable) {
          if (a.kind !== 'INSTALLMENT' || a.installmentNo == null) continue;
          if (!byNo.has(a.installmentNo)) byNo.set(a.installmentNo, []);
          byNo.get(a.installmentNo)!.push(a);
        }
        for (const [, list] of byNo) {
          list.sort((x: any, y: any) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());
          let running = 0;
          for (const a of list) {
            const key = `${a.paymentId}:${a.installmentNo}`;
            const prev = effects.get(key);
            const before = prev ? prev.before : running;
            const contributed = (prev ? prev.contributed : 0) + num(a.amount);
            running += num(a.amount);
            effects.set(key, { before, contributed, after: running });
          }
        }
      }

      const installmentPaidTotal = installments.reduce((s: number, i: any) => s + i.paid, 0);
      const installmentDiscountedTotal = installments.reduce((s: number, i: any) => s + (i.discounted ?? 0), 0);
      const totalPaid = regPaid + lumpPaid + installmentPaidTotal + transportPaid;
      const totalDiscounted = regDiscounted + installmentDiscountedTotal;
      const balance = Math.max(0, totalFee - totalPaid - totalDiscounted);

      const currentTarget = installments.find((i: any) => !i.complete) ?? null;
      const anyOverdue = installments.find((i: any) => i.overdue) ?? null;

      let status = 'on_track';
      let daysLate = 0;
      if (balance <= 0.005) {
        status = 'paid_in_full';
      } else if (anyOverdue) {
        status = 'overdue';
        daysLate = anyOverdue.daysLate;
      } else if (currentTarget && currentTarget.paid > 0) {
        status = 'partial';
      }

      const settled = totalPaid + totalDiscounted;
      const progress = totalFee > 0 ? Math.min(100, Math.round((settled / totalFee) * 100)) : 100;

      map.set(sid, {
        assigned: true,
        studentFeeStructureId: link.id,
        feeStructureId: link.feeStructureId,
        className: classByStudent.get(sid) ?? link.schoolClass?.className ?? '',
        totalFee,
        registrationFee: regFee,
        tuitionFee: tuition,
        transportFee,
        transportPaid,
        totalPaid,
        totalDiscounted,
        registrationPaid: regPaid,
        lumpPaid,
        balance,
        progress,
        status,
        daysLate,
        frequency: lower(structure.frequency),
        installments,
        currentTarget,
        effects,
      });
    }
    return map;
  }

  // GET /fees/students/:id/schedule — single source of truth for modal + table.
  async getStudentSchedule(tenantId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId, tenantId },
        select: { id: true, firstName: true, lastName: true, educationLevel: true, grade: true },
      });
      if (!student) throw new NotFoundException('Student not found');
      const sched = (await this.buildSchedules(tx, tenantId, [studentId])).get(studentId);
      return {
        studentId: student.id,
        studentName: this.fullName(student),
        educationLevel: student.educationLevel ?? '',
        grade: student.grade ?? null,
        ...sched,
      };
    });
  }

  // GET /finance/students/:id/ledger — per-student financial ledger reusing
  // buildSchedules as the single source of installment math. Fee itemization
  // follows the model (Base Tuition + Registration rows); collected-by is
  // approver-or-"—" per the locked reports rule (payments carry no recorder).
  async getStudentLedger(tenantId: string, studentId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId, tenantId },
        select: {
          id: true, firstName: true, lastName: true, roleNumber: true,
          educationLevel: true, grade: true, phone: true,
        },
      });
      if (!student) throw new NotFoundException('Student not found');

      const [guardianLinks, sched] = await Promise.all([
        tx.studentGuardian.findMany({
          where: { tenantId, studentId },
          include: { guardian: { select: { firstName: true, lastName: true, phone: true } } },
        }),
        this.buildSchedules(tx, tenantId, [studentId]).then((m) => m.get(studentId)),
      ]);

      const guardians = (guardianLinks as any[])
        .filter((g) => g.guardian)
        .map((g) => ({
          name: this.fullName(g.guardian),
          phone: g.guardian.phone ?? '',
          relationship: g.relationship ?? '',
          isPrimary: !!g.isPrimary,
        }));

      const profile = {
        id: student.id,
        name: this.fullName(student),
        roleNumber: (student as any).roleNumber ?? '',
        educationLevel: (student as any).educationLevel ?? '',
        grade: (student as any).grade ?? null,
        className: '',
        phone: (student as any).phone ?? '',
        guardians,
      };

      const [link, lifetimeLinks] = await Promise.all([
        tx.studentFeeStructure.findFirst({
          where: { tenantId, studentId },
          include: {
            feeStructure: { select: { name: true } },
            schoolClass: { select: { className: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        tx.studentFeeStructure.findMany({
          where: { tenantId, studentId },
          select: { id: true, totalFee: true, transportFee: true },
        }),
      ]);
      const currency = (link as any)?.currencyCode ?? 'SDG';
      profile.className = (link as any)?.schoolClass?.className ?? sched?.className ?? '';
      const discountRows: any[] = (await tx.discountApplication?.findMany?.({
        where: { tenantId, studentId },
      })) ?? [];
      const currentDiscounts = discountRows.filter(
        (d) => d.studentFeeStructureId === (link as any)?.id,
      );
      const regDiscounted = currentDiscounts
        .filter((d) => d.targetKind === 'REGISTRATION')
        .reduce((s, d) => s + num(d.amount), 0);
      const instDiscounted = (sched?.installments ?? []).reduce(
        (s: number, i: any) => s + num(i.discounted),
        0,
      );
      const feeRows: any[] = sched?.assigned
        ? [
            {
              label: 'Base Tuition',
              amount: num(sched.tuitionFee),
              discount: round2(instDiscounted),
              net: round2(num(sched.tuitionFee) - instDiscounted),
            },
            {
              label: 'Registration Fee',
              amount: num(sched.registrationFee),
              discount: round2(regDiscounted),
              net: round2(num(sched.registrationFee) - regDiscounted),
            },
          ]
        : [];
      // No discount machinery targets transport — the row is always undiscounted.
      if (num(sched?.transportFee) > 0.005) {
        feeRows.push({
          label: 'Transport Fee',
          amount: num(sched?.transportFee),
          discount: 0,
          net: round2(num(sched?.transportFee)),
        });
      }
      // buildSchedules exposes reg totals only via paid math — recompute the
      // registration discount bucket from the same applied-discount source.
      const fee = {
        templateName: '',
        currency,
        rows: feeRows,
        total: round2(num(sched?.totalFee)),
        totalDiscount: round2(num(sched?.totalDiscounted ?? 0)),
        netTotal: round2(num(sched?.totalFee) - num(sched?.totalDiscounted ?? 0)),
      };

      const installments = (sched?.installments ?? []).map((i: any) => {
        const remaining = Math.max(0, round2(num(i.amount) - num(i.paid) - num(i.discounted)));
        const status = i.complete ? 'PAID' : i.overdue ? 'OVERDUE' : num(i.paid) > 0 ? 'PARTIAL' : 'PENDING';
        return {
          no: i.no,
          name: `Installment ${i.no}`,
          dueDate: i.dueDate,
          amount: num(i.amount),
          discounted: num(i.discounted),
          paid: num(i.paid),
          remaining,
          status,
          overdue: !!i.overdue,
        };
      });

      const [payments, lifetimeAllocs] = await Promise.all([
        tx.payment.findMany({
          where: { tenantId, studentId },
          include: { allocations: { select: { kind: true, installmentNo: true, amount: true } } },
          orderBy: { paidAt: 'desc' },
        }),
        tx.paymentAllocation.findMany({
          where: {
            tenantId,
            studentFeeStructureId: { in: (lifetimeLinks as any[]).map((l) => l.id) },
          },
          include: { payment: { select: { status: true } } },
        }),
      ]);
      const paymentRows = (payments as any[]).map((p) => {
        const allocs = p.allocations ?? [];
        const targets = allocs.map((a: any) =>
          a.kind === 'REGISTRATION' ? 'Registration' : a.kind === 'LUMP_SUM' ? 'Lump sum' : a.kind === 'TRANSPORT' ? 'Transport' : `Installment ${a.installmentNo ?? ''}`.trim(),
        );
        const target = [...new Set(targets)].join(', ') || 'Lump sum';
        return {
          id: p.id,
          ref: p.paymentReference ?? '',
          at: p.paidAt ? new Date(p.paidAt).toISOString() : null,
          target,
          method: p.method,
          amount: num(p.amount),
          currencyCode: p.currencyCode ?? currency,
          status: p.status,
          by: '-',
        };
      });

      const lifetimeBilled = (lifetimeLinks as any[]).reduce(
        (sum, row) => sum + num(row.totalFee) + num(row.transportFee),
        0,
      );
      const lifetimeDiscount = discountRows.reduce((sum, row) => sum + num(row.amount), 0);
      const assigned = (lifetimeLinks as any[]).length
        ? Math.max(0, round2(lifetimeBilled - lifetimeDiscount))
        : fee.netTotal;
      const paid = round2(
        (lifetimeAllocs as any[])
          .filter((allocation) => allocation.payment?.status !== 'REFUNDED')
          .reduce((sum, allocation) => sum + num(allocation.amount), 0),
      );
      const balance = Math.max(0, round2(assigned - paid));
      const status = balance <= 0.005 ? 'FULLY_PAID' : sched?.status === 'overdue' ? 'OVERDUE' : 'PARTIALLY_PAID';

      fee.templateName = (link as any)?.feeStructure?.name ?? '';

      return {
        profile,
        fee,
        installments,
        payments: paymentRows,
        totals: { assigned, paid, balance, status, currency },
      };
    });
  }

  // POST /fees/assign — link a student to a fee structure (explicit assignment).
  async assignFeeStructure(tenantId: string, dto: { studentId: string; feeStructureId: string; classId?: string }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: dto.studentId, tenantId } });
      if (!student) throw new NotFoundException('Student not found');
      const structure = await tx.feeStructure.findFirst({
        where: { id: dto.feeStructureId, tenantId },
        include: { installments: { orderBy: { installmentNo: 'asc' } } },
      });
      if (!structure) throw new NotFoundException('Fee structure not found');
      const year = await this.latestAcademicYear(tx, tenantId);

      const totalFee = num(structure.tuitionFee) + num(structure.registrationFee);
      const existing = await tx.studentFeeStructure.findFirst({
        where: { tenantId, academicYearId: year.id, studentId: student.id },
      });
      const data = {
        tenantId,
        studentId: student.id,
        academicYearId: year.id,
        feeStructureId: structure.id,
        classId: dto.classId ?? existing?.classId ?? null,
        totalFee,
        currencyCode: structure.currencyCode,
      };
      const link = existing
        ? await tx.studentFeeStructure.update({ where: { id: existing.id }, data })
        : await tx.studentFeeStructure.create({ data });
      return { id: link.id, studentId: student.id, feeStructureId: structure.id, totalFee };
    });
  }

  // Transport portal hook: set (or clear) the annual transport charge on the
  // student's billing link. Reuses resolveStudentLink so a student without a
  // link gets the school-determined structure created — one annual link, no
  // second billing row.
  async setStudentTransportFee(tenantId: string, studentId: string, amount: number) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const amt = Number(amount);
      if (!(Number.isFinite(amt) && amt >= 0)) {
        throw new BadRequestException('Transport fee must be a non-negative number');
      }
      const { link } = await this.resolveStudentLink(tx, tenantId, studentId);
      await tx.studentFeeStructure.update({ where: { id: link.id }, data: { transportFee: round2(amt) } });
      return { studentId, transportFee: round2(amt) };
    });
  }

  // Transport portal reads: transport charge vs collected for the given
  // students, derived from the same buildSchedules math as the ledger.
  async getTransportFeeStatus(tenantId: string, studentIds: string[]) {
    const rows = await this.prisma.withTenantRead(tenantId, async (tx) => {
      const schedules = await this.buildSchedules(tx, tenantId, studentIds);
      return studentIds.map((sid) => {
        const sched: any = schedules.get(sid);
        const transportFee = num(sched?.transportFee ?? 0);
        const transportPaid = num(sched?.transportPaid ?? 0);
        const status = transportFee <= 0.005
          ? 'NOT_BILLED'
          : transportPaid >= transportFee - 0.005 ? 'PAID'
          : transportPaid > 0.005 ? 'PARTIAL'
          : 'PENDING';
        return { studentId: sid, transportFee, transportPaid, status };
      });
    });
    return rows;
  }

  private methodToEnum(m: string): 'CASH' | 'BANKAK' | 'FAWRY' | 'OKASH' | 'AL_MASHRIQ' {
    const map: Record<string, any> = {
      cash: 'CASH', bankak: 'BANKAK', fawry: 'FAWRY',
      okash: 'OKASH', al_mashriq: 'AL_MASHRIQ', 'al mashriq': 'AL_MASHRIQ', almashriq: 'AL_MASHRIQ',
    };
    return map[lower(m)] ?? 'CASH';
  }

  // Resolve the student + their fee-structure link, auto-assigning (best-match)
  // when none exists so a payment is never orphaned. Shared by recordPayment
  // and recordPaymentAllOutstanding.
  private async resolveStudentLink(tx: any, tenantId: string, studentId: string) {
    const student = await tx.student.findFirst({ where: { id: studentId, tenantId } });
    if (!student) throw new NotFoundException('Student not found');
    const year = await this.latestAcademicYear(tx, tenantId);

    let link = await tx.studentFeeStructure.findFirst({
      where: { tenantId, academicYearId: year.id, studentId: student.id },
      include: { feeStructure: { include: { installments: { orderBy: { installmentNo: 'asc' } } } } },
    });

    if (!link) {
      const structure = await this.resolveStructureForStudent(tx, tenantId, student, year.id);
      if (!structure) {
        throw new BadRequestException(
          'No matching fee structure for this student. Assign one first via /fees/assign.',
        );
      }
      const totalFee = num(structure.tuitionFee) + num(structure.registrationFee);
      link = await tx.studentFeeStructure.create({
        data: {
          tenantId,
          studentId: student.id,
          academicYearId: year.id,
          feeStructureId: structure.id,
          totalFee,
          currencyCode: structure.currencyCode,
        },
        include: { feeStructure: { include: { installments: { orderBy: { installmentNo: 'asc' } } } } },
      });
    }
    return { student, year, link, structure: link.feeStructure };
  }

  // Discount planner: converts selected DiscountEligibility ids into concrete
  // per-target reductions. Each eligibility is consumed at most once
  // (remaining = base − appliedAmount); reductions land on targets in the
  // canonical order (registration, then installments ascending) and can never
  // exceed a target's remaining capacity — zero floor by construction.
  // Percentage base = the resolved structure's totalFee (annual total).
  private async planDiscountApplications(
    tx: any,
    tenantId: string,
    studentId: string,
    link: any,
    structure: any,
    discountIds: string[] | undefined,
  ) {
    const empty = { applications: [], totalDiscount: 0, targets: [] as any[], eligById: new Map<string, any>() };
    if (!discountIds?.length) return empty;

    const rows: any[] = await tx.discountEligibility.findMany({
      where: { tenantId, studentId, id: { in: discountIds } },
    });
    const found = new Set((rows ?? []).map((r: any) => String(r.id)));
    const missing = discountIds.filter((id) => !found.has(String(id)));
    if (missing.length) {
      throw new BadRequestException('Unknown or stale discount selection');
    }

    const totalFee = num(link.totalFee) || num(structure.tuitionFee) + num(structure.registrationFee);

    const allocs: any[] = await tx.paymentAllocation.findMany({
      where: { tenantId, studentFeeStructureId: link.id },
      include: { payment: { select: { status: true } } },
    });
    const priorDiscounts: any[] = (await tx.discountApplication?.findMany?.({
      where: { tenantId, studentFeeStructureId: link.id },
    })) ?? [];

    const paidByNo = new Map<number, number>();
    let regPaid = 0;
    for (const a of allocs ?? []) {
      if (a.payment?.status === 'REFUNDED') continue;
      if (a.kind === 'REGISTRATION') regPaid += num(a.amount);
      else if (a.kind === 'INSTALLMENT' && a.installmentNo != null) {
        paidByNo.set(a.installmentNo, (paidByNo.get(a.installmentNo) ?? 0) + num(a.amount));
      }
    }
    const discountedByNo = new Map<number, number>();
    let regDiscounted = 0;
    for (const d of priorDiscounts) {
      if (d.targetKind === 'REGISTRATION') regDiscounted += num(d.amount);
      else if (d.targetKind === 'INSTALLMENT' && d.installmentNo != null) {
        discountedByNo.set(d.installmentNo, (discountedByNo.get(d.installmentNo) ?? 0) + num(d.amount));
      }
    }

    const targets: any[] = [];
    const regFee = num(structure.registrationFee);
    if (regFee > 0) {
      targets.push({ kind: 'REGISTRATION', installmentNo: null, total: regFee, paid: regPaid, discounted: regDiscounted, discountApplied: 0 });
    }
    for (const fi of (structure.installments ?? []).slice()
      .sort((a: any, b: any) => a.installmentNo - b.installmentNo)) {
      targets.push({
        kind: 'INSTALLMENT',
        installmentNo: fi.installmentNo,
        total: num(fi.amount),
        paid: paidByNo.get(fi.installmentNo) ?? 0,
        discounted: discountedByNo.get(fi.installmentNo) ?? 0,
        discountApplied: 0,
      });
    }

    const now = new Date();
    const byId = new Map<string, any>((rows ?? []).map((r: any) => [String(r.id), r]));
    const applications: any[] = [];
    for (const id of discountIds) {
      const r = byId.get(String(id));
      if (r.expiresAt && new Date(r.expiresAt) <= now) {
        throw new BadRequestException(`Discount "${r.label}" has expired`);
      }
      const base = r.valueType === 'PERCENTAGE' ? round2((totalFee * num(r.value)) / 100) : num(r.value);
      let remaining = round2(base - num(r.appliedAmount));
      if (remaining <= 0.005) {
        throw new BadRequestException(`Discount "${r.label}" is already fully applied`);
      }
      for (const t of targets) {
        if (remaining <= 0.005) break;
        const capacity = Math.max(0, round2(t.total - t.paid - t.discounted - t.discountApplied));
        if (capacity <= 0.005) continue;
        const take = round2(Math.min(remaining, capacity));
        t.discountApplied = round2(t.discountApplied + take);
        remaining = round2(remaining - take);
        applications.push({
          eligibilityId: r.id,
          label: r.label,
          targetKind: t.kind,
          installmentNo: t.installmentNo,
          amount: take,
        });
      }
    }
    const totalDiscount = round2(applications.reduce((s, a) => s + a.amount, 0));
    return { applications, totalDiscount, targets, eligById: byId };
  }

  private async persistDiscountApplications(
    tx: any,
    tenantId: string,
    studentId: string,
    linkId: string,
    plan: { applications: any[]; eligById: Map<string, any> },
    paymentId: string | null,
  ) {
    const bumped = new Map<string, number>();
    for (const a of plan.applications) {
      await tx.discountApplication.create({
        data: {
          tenantId,
          studentId,
          studentFeeStructureId: linkId,
          eligibilityId: a.eligibilityId,
          paymentId,
          targetKind: a.targetKind,
          installmentNo: a.installmentNo,
          amount: a.amount,
        },
      });
      bumped.set(a.eligibilityId, round2((bumped.get(a.eligibilityId) ?? 0) + a.amount));
    }
    for (const [eligibilityId, amount] of bumped) {
      const current = plan.eligById.get(String(eligibilityId));
      await tx.discountEligibility.update({
        where: { id: eligibilityId },
        data: {
          appliedAmount: round2(num(current?.appliedAmount) + amount),
          appliedAt: new Date(),
        },
      });
    }
  }

  // POST /finance/payments — record a payment with explicit allocations.
  async recordPayment(tenantId: string, dto: {
    studentId: string;
    allocations: { installmentNo?: number | null; kind: string; amount: number }[];
    method: string;
    transactionId?: string;
    notes?: string;
    discountIds?: string[];
  }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const { student, link, structure } = await this.resolveStudentLink(tx, tenantId, dto.studentId);
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const currencyCode = (tenant as any)?.currencyCode ?? 'SDG';

      // Validate allocations server-side. Never trust client totals.
      const validInstallmentNos = new Set((structure.installments ?? []).map((i: any) => i.installmentNo));
      let totalAmount = 0;
      const normalized: { installmentNo: number | null; kind: any; amount: number }[] = [];
      for (const a of dto.allocations ?? []) {
        const amt = Number(a.amount);
        if (!(amt > 0)) throw new BadRequestException('Allocation amounts must be positive');
        const kindRaw = lower(a.kind);
        let kind: 'INSTALLMENT' | 'REGISTRATION' | 'LUMP_SUM' | 'TRANSPORT';
        if (kindRaw === 'registration') kind = 'REGISTRATION';
        else if (kindRaw === 'lump_sum' || kindRaw === 'lump-sum' || kindRaw === 'lumpsum') kind = 'LUMP_SUM';
        else if (kindRaw === 'transport') kind = 'TRANSPORT';
        else kind = 'INSTALLMENT';

        if (kind === 'INSTALLMENT') {
          const no = Number(a.installmentNo);
          if (!validInstallmentNos.has(no)) {
            throw new BadRequestException(`Invalid installment number ${a.installmentNo}`);
          }
          normalized.push({ installmentNo: no, kind, amount: amt });
        } else {
          normalized.push({ installmentNo: null, kind, amount: amt });
        }
        totalAmount += amt;
      }
      if (!(totalAmount > 0)) throw new BadRequestException('Payment amount must be positive');

      // Payment-time discounts: selected eligibilities consume target
      // capacity before the payment does (earliest targets first). Planned
      // before validation so the guard below sees the reduced capacity.
      const discountPlan = await this.planDiscountApplications(
        tx, tenantId, student.id, link, structure, dto.discountIds,
      );
      const targetByNo = new Map<number, any>(
        (discountPlan.targets ?? []).map((t: any) => [t.installmentNo, t] as [number, any]),
      );

      // Task 4: reject INSTALLMENT allocations that exceed the installment's
      // outstanding balance. Prior partial payments narrow the remainder; a
      // repeat submission that would over-allocate must fail loudly, not
      // silently overpay. REFUNDED payments are excluded, matching buildSchedules.
      // Planned discounts narrow the remainder the same way. TRANSPORT rides
      // the link's transportFee with the same paid/narrowed-remainder rule.
      {
        const existing = await tx.paymentAllocation.findMany({
          where: { tenantId, studentFeeStructureId: link.id, kind: { in: ['INSTALLMENT', 'TRANSPORT'] } },
          include: { payment: { select: { status: true } } },
        });
        const paidByNo = new Map<number, number>();
        let transportPaid = 0;
        for (const a of existing ?? []) {
          if (a.payment?.status === 'REFUNDED') continue;
          if (a.kind === 'TRANSPORT') {
            transportPaid += num(a.amount);
          }
          if (a.installmentNo == null) continue;
          paidByNo.set(a.installmentNo, (paidByNo.get(a.installmentNo) ?? 0) + num(a.amount));
        }
        const requestedTransport = normalized
          .filter((n) => n.kind === 'TRANSPORT')
          .reduce((s, n) => s + n.amount, 0);
        if (requestedTransport > 0.005) {
          const transportOutstanding = Math.max(0, round2(num(link.transportFee) - transportPaid));
          if (requestedTransport > transportOutstanding + 0.005) {
            throw new BadRequestException(
              `Payment of ${requestedTransport} exceeds the outstanding ${transportOutstanding} for transport`,
            );
          }
        }
        const requestedByNo = new Map<number, number>();
        for (const n of normalized) {
          if (n.kind !== 'INSTALLMENT' || n.installmentNo == null) continue;
          const fi = (structure.installments ?? []).find((i: any) => i.installmentNo === n.installmentNo);
          const planned = targetByNo.get(n.installmentNo);
          const outstanding = planned
            ? Math.max(0, round2(planned.total - planned.paid - planned.discounted - planned.discountApplied))
            : Math.max(0, num(fi?.amount) - (paidByNo.get(n.installmentNo) ?? 0));
          const requested = (requestedByNo.get(n.installmentNo) ?? 0) + n.amount;
          requestedByNo.set(n.installmentNo, requested);
          if (requested > outstanding + 0.005) {
            throw new BadRequestException(
              `Payment of ${n.amount} exceeds the outstanding ${outstanding} for installment #${n.installmentNo}`,
            );
          }
        }
      }

      // Match feeInstallmentId for INSTALLMENT allocations.
      const fiByNo = new Map<number, string>(
        (structure.installments ?? []).map((i: any) => [i.installmentNo, i.id] as [number, string]),
      );

      const payment = await tx.payment.create({
        data: {
          tenantId,
          studentId: student.id,
          amount: totalAmount,
          currencyCode,
          method: this.methodToEnum(dto.method),
          paymentReference: dto.transactionId || null,
          status: 'COMPLETED',
          notes: dto.notes ?? null,
          allocations: {
            create: normalized.map((n) => ({
              studentFeeStructureId: link.id,
              feeInstallmentId: n.kind === 'INSTALLMENT' ? (fiByNo.get(n.installmentNo ?? -1) ?? null) : null,
              installmentNo: n.installmentNo,
              amount: n.amount,
              kind: n.kind,
            })),
          },
        },
        include: { allocations: true },
      });

      await this.persistDiscountApplications(
        tx, tenantId, student.id, link.id, discountPlan, payment.id,
      );

      await this.realtime.emitDomainEvent({
        kind: 'payment.recorded',
        rooms: [financeRoom(tenantId)],
        payload: { paymentId: payment.id, studentId: student.id },
      });

      return {
        id: payment.id,
        studentId: student.id,
        amount: totalAmount,
        method: lower(payment.method),
        status: 'completed',
        allocations: normalized,
        discounts: discountPlan.applications.map((a: any) => ({
          eligibilityId: a.eligibilityId,
          label: a.label,
          amount: a.amount,
        })),
        totalDiscount: discountPlan.totalDiscount,
      };
    });
  }

  // POST /finance/payments/pay-all — settle every open installment for a student
  // in one action (spec Task 6). One Payment with one allocation per open
  // target, in installment-number order, inside a single transaction — so the
  // receipt lists every settled installment. Registration is stored separately
  // from tuition installments, so its remainder gets its own allocation row.
  async recordPaymentAllOutstanding(tenantId: string, dto: {
    studentId: string;
    method: string;
    transactionId?: string;
    notes?: string;
    discountIds?: string[];
  }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const { student, link, structure } = await this.resolveStudentLink(tx, tenantId, dto.studentId);
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      const currencyCode = (tenant as any)?.currencyCode ?? 'SDG';

      const existing = await tx.paymentAllocation.findMany({
        where: { tenantId, studentFeeStructureId: link.id },
        include: { payment: { select: { status: true } } },
      });
      const paidByNo = new Map<number, number>();
      let regPaid = 0;
      let transportPaid = 0;
      for (const a of existing ?? []) {
        if (a.payment?.status === 'REFUNDED') continue;
        if (a.kind === 'REGISTRATION') regPaid += num(a.amount);
        else if (a.kind === 'TRANSPORT') transportPaid += num(a.amount);
        else if (a.kind === 'INSTALLMENT' && a.installmentNo != null) {
          paidByNo.set(a.installmentNo, (paidByNo.get(a.installmentNo) ?? 0) + num(a.amount));
        }
      }

      // Payment-time discounts consume target capacity first (same canonical
      // order as the settlement below), so the payable below is net of them.
      const discountPlan = await this.planDiscountApplications(
        tx, tenantId, student.id, link, structure, dto.discountIds,
      );

      const normalized: { installmentNo: number | null; kind: any; amount: number }[] = [];
      if (discountPlan.targets.length) {
        for (const t of discountPlan.targets) {
          const remaining = round2(t.total - t.paid - t.discounted - t.discountApplied);
          if (remaining > 0.005) {
            normalized.push({ installmentNo: t.installmentNo, kind: t.kind, amount: remaining });
          }
        }
      } else {
        const regFee = num(structure.registrationFee);
        if (regFee - regPaid > 0.005) {
          normalized.push({ installmentNo: null, kind: 'REGISTRATION', amount: round2(regFee - regPaid) });
        }
        for (const fi of (structure.installments ?? []).slice()
          .sort((a: any, b: any) => a.installmentNo - b.installmentNo)) {
          const outstanding = num(fi.amount) - (paidByNo.get(fi.installmentNo) ?? 0);
          if (outstanding > 0.005) {
            normalized.push({ installmentNo: fi.installmentNo, kind: 'INSTALLMENT', amount: round2(outstanding) });
          }
        }
      }
      // Transport rides every pay-all regardless of the discount branch.
      const transportOutstanding = round2(num((link as any).transportFee) - transportPaid);
      if (transportOutstanding > 0.005) {
        normalized.push({ installmentNo: null, kind: 'TRANSPORT', amount: transportOutstanding });
      }
      const discountSummary = {
        discounts: discountPlan.applications.map((a: any) => ({
          eligibilityId: a.eligibilityId,
          label: a.label,
          amount: a.amount,
        })),
        totalDiscount: discountPlan.totalDiscount,
      };
      if (!normalized.length) {
        if (discountPlan.totalDiscount > 0) {
          // Discounts settle the whole balance: no cash changes hands, so no
          // Payment row — applications are recorded standalone (paymentId null).
          await this.persistDiscountApplications(tx, tenantId, student.id, link.id, discountPlan, null);
          return {
            id: null,
            studentId: student.id,
            amount: 0,
            method: lower(this.methodToEnum(dto.method)),
            status: 'completed',
            allocations: normalized,
            ...discountSummary,
          };
        }
        throw new BadRequestException('No outstanding installments for this student');
      }

      const totalAmount = normalized.reduce((s, n) => s + n.amount, 0);
      const fiByNo = new Map<number, string>(
        (structure.installments ?? []).map((i: any) => [i.installmentNo, i.id] as [number, string]),
      );
      const payment = await tx.payment.create({
        data: {
          tenantId,
          studentId: student.id,
          amount: totalAmount,
          currencyCode,
          method: this.methodToEnum(dto.method),
          paymentReference: dto.transactionId || null,
          status: 'COMPLETED',
          notes: dto.notes ?? null,
          allocations: {
            create: normalized.map((n) => ({
              studentFeeStructureId: link.id,
              feeInstallmentId: n.kind === 'INSTALLMENT' ? (fiByNo.get(n.installmentNo ?? -1) ?? null) : null,
              installmentNo: n.installmentNo,
              amount: n.amount,
              kind: n.kind,
            })),
          },
        },
        include: { allocations: true },
      });

      await this.persistDiscountApplications(
        tx, tenantId, student.id, link.id, discountPlan, payment.id,
      );

      await this.realtime.emitDomainEvent({
        kind: 'payment.recorded',
        rooms: [financeRoom(tenantId)],
        payload: { paymentId: payment.id, studentId: student.id },
      });

      return {
        id: payment.id,
        studentId: student.id,
        amount: totalAmount,
        method: lower(payment.method),
        status: 'completed',
        allocations: normalized,
        ...discountSummary,
      };
    });
  }

  async verifyPayment(tenantId: string, id: string) {
    const p: any = await this.payments.verifyPayment(tenantId, id);
    return { id: p.id, status: 'completed' };
  }

  async getPaymentReceipt(tenantId: string, id: string) {
    const payment = await this.prisma.withTenantRead(tenantId, async (tx) => {
      return tx.payment.findUnique({
        where: { id, tenantId },
        include: {
          student: { select: { id: true, firstName: true, lastName: true, educationLevel: true, grade: true } },
          allocations: {
            include: { feeInstallment: true },
          },
          discountApplications: {
            include: { eligibility: { select: { label: true } } },
          },
        },
      });
    });

    if (!payment) throw new NotFoundException('Payment not found');

    // Build receipt data
    const studentName = `${payment.student?.firstName ?? ''} ${payment.student?.lastName ?? ''}`.trim();
    const allocations = payment.allocations.map((a: any) => ({
      kind: a.kind,
      installmentNo: a.installmentNo,
      amount: num(a.amount),
      installmentName: a.kind === 'INSTALLMENT' ? `Installment #${a.installmentNo}`
        : a.kind === 'REGISTRATION' ? 'Registration Fee'
        : a.kind === 'TRANSPORT' ? 'Transport Fee'
        : 'Lump Sum (Full Year)',
    }));
    // Discount lines carry the display label only — the eligibility row never
    // stores the sensitive family-condition reason, so receipts stay redacted.
    const discounts = (payment.discountApplications ?? []).map((d: any) => ({
      label: d.eligibility?.label ?? 'Discount',
      amount: num(d.amount),
    }));

    // Task 2: pass raw Dates and format with an explicit locale at render time,
    // so the PDF does not depend on the server's locale/timezone. Receipt
    // issue date is the payment's createdAt — stable across reprints.
    const receiptData = {
      paymentId: payment.id,
      paymentReference: payment.paymentReference,
      studentName,
      studentId: payment.studentId,
      amount: num(payment.amount),
      currencyCode: payment.currencyCode,
      method: payment.method,
      paidAt: new Date(payment.paidAt),
      receiptIssuedAt: new Date((payment as any).createdAt ?? payment.paidAt),
      allocations,
      discounts,
      totalDiscount: discounts.reduce((s: number, d: any) => s + d.amount, 0),
      notes: payment.notes,
    };

    // Generate PDF using pdfkit (same pattern as payslips)
    const buffer = await this.generateReceiptPdf(receiptData);
    return { buffer, filename: `receipt-${payment.id}.pdf` };
  }

  async listDiscounts(tenantId: string) {
    const rows: any[] = await this.discounts.listDiscountTypes(tenantId);
    return rows.map((d: any) => ({ id: d.id, name: d.name, type: lower(d.kind), value: 0, active: true }));
  }

  async listStudentDiscounts(tenantId: string, status?: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const rows = await tx.studentDiscount.findMany({
        where: { tenantId, ...(status ? { status: status.toUpperCase() as any } : {}) },
        include: {
          student: { select: { firstName: true, lastName: true } },
          discountType: { select: { name: true } },
        },
        orderBy: { id: 'desc' },
        take: 200,
      });
      return rows.map((d: any) => ({
        id: d.id,
        studentId: d.studentId,
        studentName: d.student ? this.fullName(d.student) : '',
        discountId: d.discountTypeId,
        discountName: d.discountType?.name ?? '',
        status: lower(d.status),
      }));
    });
  }

  async approveStudentDiscount(tenantId: string, userId: string, id: string) {
    return this.discounts.approveDiscount(tenantId, userId, id);
  }

  async rejectStudentDiscount(tenantId: string, id: string) {
    return this.discounts.rejectDiscount(tenantId, id);
  }

  private scopeLabel(s: any): string | null {
    if (!s) return null;
    const edu = String(s.educationLevel ?? '');
    const level = edu ? edu.charAt(0).toUpperCase() + edu.slice(1).toLowerCase() : '';
    const parts = [
      level,
      s.grade != null && String(s.grade) !== '' ? `Grade ${s.grade}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }

  private kindToValueType(kind: unknown): 'PERCENTAGE' | 'FIXED_AMOUNT' | null {
    const k = String(kind ?? '').toLowerCase();
    if (k === 'percentage') return 'PERCENTAGE';
    if (k === 'fixed' || k === 'fixed_amount') return 'FIXED_AMOUNT';
    // Unknown kinds stay null (mirrors the rules union): the bridge drops
    // them silently, so the ledger must not display a confident wrong type.
    return null;
  }

  // --- Unified assigned-discounts ledger (2-tab workspace) ------------------
  // Rows carry `source` so the client routes approve/reject to the owning
  // endpoint (student-discounts vs family-conditions). Topper rows are
  // already-effective eligibilities: no actions, status derived from expiry.
  // Ordering is source-grouped (deterministic); cross-source recency sort is
  // deliberately avoided — the three sources have incomparable timestamps.
  async listAssignedDiscounts(tenantId: string, userId: string, canViewReason: boolean) {
    if (canViewReason) {
      // Audit parity with the family-conditions list endpoint: sensitive
      // reasons flow through this ledger too, so the view is recorded.
      await this.payroll.recordFamilyConditionView(tenantId, userId);
    }
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [discounts, families, toppers] = await Promise.all([
        tx.studentDiscount.findMany({
          where: { tenantId },
          include: {
            student: { select: { firstName: true, lastName: true, educationLevel: true, grade: true } },
            discountType: { select: { name: true, kind: true } },
          },
          orderBy: { id: 'desc' },
          take: 200,
        }),
        tx.familyConditionDiscount.findMany({
          where: { tenantId },
          include: {
            student: { select: { firstName: true, lastName: true, educationLevel: true, grade: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
        tx.discountEligibility.findMany({
          where: { tenantId, sourceType: 'TOPPER' },
          include: {
            student: { select: { firstName: true, lastName: true, educationLevel: true, grade: true } },
            academicYear: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
      ]);
      const now = new Date();
      return [
        ...discounts.map((d: any) => ({
          id: d.id,
          source: 'STUDENT_DISCOUNT',
          studentId: d.studentId,
          studentName: d.student ? this.fullName(d.student) : '',
          grade: this.scopeLabel(d.student),
          category: d.relationApplied ? 'SIBLING' : 'MANUAL',
          name: d.discountType?.name ?? '',
          valueType: this.kindToValueType(d.discountType?.kind),
          value: num(d.value),
          notes: null,
          academicYear: null,
          status: lower(d.status),
          actions: d.status === 'PENDING' ? ['approve', 'reject'] : [],
        })),
        ...families.map((f: any) => ({
          id: f.id,
          source: 'FAMILY_CONDITION',
          studentId: f.studentId,
          studentName: f.student ? this.fullName(f.student) : '',
          grade: this.scopeLabel(f.student),
          category: 'SPECIAL_DISCRETION',
          name: 'Special Family Condition',
          valueType: f.valueType,
          value: num(f.value),
          notes: canViewReason ? f.reason : null,
          academicYear: null,
          status: lower(f.status),
          actions: f.status === 'PENDING' ? ['approve', 'reject'] : [],
        })),
        ...toppers.map((e: any) => ({
          id: e.id,
          source: 'TOPPER',
          studentId: e.studentId,
          studentName: e.student ? this.fullName(e.student) : '',
          grade: this.scopeLabel(e.student),
          category: 'TOPPER',
          name: e.label ?? 'Class Topper',
          valueType: e.valueType,
          value: num(e.value),
          notes: null,
          academicYear: e.academicYear?.name ?? null,
          status: e.expiresAt && new Date(e.expiresAt) <= now ? 'expired' : 'active',
          actions: [],
        })),
      ];
    });
  }

  async listEligibleDiscounts(tenantId: string, studentId: string, academicYearId?: string) {
    return this.discounts.listEligibleDiscounts(tenantId, studentId, academicYearId);
  }

  async listExpenses(tenantId: string, status?: string) {
    const rows: any[] = await this.expenses.listExpenses(tenantId, status ? status.toUpperCase() : undefined);
    return rows.map((e: any) => ({
      id: e.id,
      categoryId: e.categoryId,
      categoryName: e.category?.name ?? '',
      amount: num(e.amount),
      currencyCode: e.currency,
      title: e.description ?? '',
      description: e.description ?? '',
      vendor: e.vendor ?? '',
      status: lower(e.status),
      incurredAt: new Date(e.date).toISOString(),
    }));
  }

  private async resolveExpenseCategory(tenantId: string, name: string): Promise<string> {
    const cat: any = await this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.expenseCategory.findFirst({ where: { tenantId, name } });
      if (existing) return existing;
      return tx.expenseCategory.create({ data: { tenantId, name } });
    });
    return cat.id;
  }

  async createExpense(
    tenantId: string,
    dto: { category: string; amount: number; title?: string; description?: string; vendor?: string; date?: string },
  ) {
    if (!dto.category?.trim()) throw new BadRequestException('Category is required');
    if (!(dto.amount > 0)) throw new BadRequestException('Amount must be greater than zero');
    const tenant = await this.prisma.withTenantRead(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId } }),
    );
    const categoryId = await this.resolveExpenseCategory(tenantId, dto.category.trim());
    const title = dto.title?.trim() || dto.description?.trim() || '';
    // Backward compat: legacy callers send only `description`; it doubles as the payee.
    const vendor = dto.vendor?.trim() || title;
    const created: any = await this.expenses.createExpense(tenantId, {
      categoryId,
      amount: dto.amount,
      currency: (tenant as any)?.currencyCode ?? 'SDG',
      date: dto.date || new Date().toISOString().slice(0, 10),
      vendor,
      description: title,
    } as any);
    return { id: created.id };
  }

  async updateExpense(
    tenantId: string,
    id: string,
    dto: { category?: string; amount?: number; title?: string; vendor?: string; date?: string },
  ) {
    if (dto.amount !== undefined && !(dto.amount > 0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }
    const patch: any = {};
    if (dto.category?.trim()) patch.categoryId = await this.resolveExpenseCategory(tenantId, dto.category.trim());
    if (dto.amount !== undefined) patch.amount = dto.amount;
    if (dto.title !== undefined) patch.description = dto.title.trim();
    if (dto.vendor !== undefined) patch.vendor = dto.vendor.trim();
    if (dto.date) patch.date = dto.date;
    return this.expenses.updateExpense(tenantId, id, patch);
  }

  async deleteExpense(tenantId: string, id: string) {
    return this.expenses.deleteExpense(tenantId, id);
  }

  async approveExpense(tenantId: string, userId: string, id: string) {
    return this.expenses.approveExpense(tenantId, userId, id);
  }

  async rejectExpense(tenantId: string, id: string, reason?: string) {
    if (reason !== undefined && reason.trim() === '') {
      throw new BadRequestException('Rejection reason is required');
    }
    return this.expenses.rejectExpense(tenantId, id, reason?.trim());
  }

  async listRefunds(tenantId: string) {
    const rows: any[] = await this.expenses.listRefunds(tenantId);
    return Promise.all(rows.map(async (r: any) => {
      const payment = await this.prisma.withTenantRead(tenantId, (tx) =>
        tx.payment.findUnique({
          where: { id: r.paymentId },
          include: { student: { select: { firstName: true, lastName: true } } },
        }),
      );
      return {
        id: r.id,
        paymentId: r.paymentId,
        studentId: (payment as any)?.studentId ?? '',
        studentName: (payment as any)?.student ? this.fullName((payment as any).student) : '',
        amount: num(r.amount),
        reason: r.reason,
        status: lower(r.status),
        createdAt: new Date().toISOString(),
      };
    }));
  }

  async listAccounts(tenantId: string) {
    const accounts: any[] = await this.cash.listAccounts(tenantId);
    return Promise.all(accounts.map(async (a: any) => {
      const txns: any[] = await this.cash.listTransactions(tenantId, a.id);
      const credits = txns.filter((t) => t.type === 'CREDIT').reduce((s, t) => s + num(t.amount), 0);
      const debits = txns.filter((t) => t.type === 'DEBIT').reduce((s, t) => s + num(t.amount), 0);
      return {
        id: a.id,
        name: a.name,
        type: lower(a.type),
        balance: Math.round((num(a.openingBalance) + credits - debits) * 100) / 100,
        currency: a.currency,
      };
    }));
  }

  async listClosings(tenantId: string) {
    const rows: any[] = await this.cash.listClosings(tenantId);
    return Promise.all(rows.map(async (c: any) => {
      let cashierName = '';
      try {
        const u: any = await this.prisma.withTenantRead(tenantId, (tx) =>
          tx.user.findUnique({
            where: { id: c.closedBy },
            select: { firstName: true, lastName: true },
          }),
        );
        if (u) cashierName = this.fullName(u);
      } catch {
        cashierName = '';
      }
      const variance = num(c.discrepancy);
      return {
        id: c.id,
        accountId: c.accountId,
        accountName: c.account?.name ?? '',
        date: new Date(c.date).toISOString(),
        expected: num(c.closingAmount),
        counted: num(c.countedAmount),
        variance,
        status: variance === 0 ? 'CLOSED' : 'FLAGGED_REVIEW',
        cashierName,
      };
    }));
  }

  async getExpectedCash(tenantId: string, accountId: string, _date?: string) {
    const expected = await this.cash.getExpectedCash(tenantId, accountId);
    return { accountId, expected };
  }

  async createClosing(
    tenantId: string,
    userId: string,
    dto: { accountId: string; date?: string; countedAmount: number; notes?: string },
  ) {
    if (!(dto.countedAmount >= 0)) throw new BadRequestException('Counted amount cannot be negative');
    const expected = await this.cash.getExpectedCash(tenantId, dto.accountId);
    const variance = Math.round((dto.countedAmount - expected) * 100) / 100;
    if (variance !== 0 && !dto.notes?.trim()) {
      throw new BadRequestException('Notes are required when the counted cash differs from the system amount');
    }
    const created: any = await this.cash.dailyClosing(tenantId, userId, {
      accountId: dto.accountId,
      date: dto.date || new Date().toISOString().slice(0, 10),
      countedAmount: dto.countedAmount,
      notes: dto.notes?.trim(),
    } as any);
    return { id: created.id, variance };
  }

  async listTransfers(tenantId: string) {
    const [txns, accounts]: any[] = await Promise.all([
      this.cash.listTransactions(tenantId),
      this.cash.listAccounts(tenantId),
    ]);
    const names = new Map(accounts.map((a: any) => [a.id, a.name]));
    const byToken = new Map<string, any[]>();
    for (const t of txns) {
      if (typeof t.referenceType === 'string' && t.referenceType.startsWith('XFER:')) {
        const legs = byToken.get(t.referenceType) ?? [];
        legs.push(t);
        byToken.set(t.referenceType, legs);
      }
    }
    const rows: any[] = [];
    for (const [token, legs] of byToken) {
      const debit = legs.find((l) => l.type === 'DEBIT');
      const credit = legs.find((l) => l.type === 'CREDIT');
      if (!debit || !credit) continue;
      const at = new Date(Math.max(new Date(debit.occurredAt).getTime(), new Date(credit.occurredAt).getTime()));
      rows.push({
        id: token,
        date: at.toISOString(),
        fromAccountId: debit.accountId,
        fromAccountName: names.get(debit.accountId) ?? '',
        toAccountId: credit.accountId,
        toAccountName: names.get(credit.accountId) ?? '',
        amount: num(debit.amount),
        reference: debit.reference ?? credit.reference ?? '',
      });
    }
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 200);
  }

  async createTransfer(
    tenantId: string,
    userId: string,
    dto: { fromAccountId: string; toAccountId: string; amount: number; reference?: string; notes?: string },
  ) {
    return this.cash.transferFunds(tenantId, userId, dto);
  }

  async listCashbook(tenantId: string) {
    const txns: any[] = await this.cash.listTransactions(tenantId);
    const accounts: any[] = await this.cash.listAccounts(tenantId);
    const names = new Map(accounts.map((a: any) => [a.id, a.name]));
    const currencies = new Map(accounts.map((a: any) => [a.id, a.currency]));
    return txns.slice(0, 200).map((t: any) => ({
      id: t.id,
      accountId: t.accountId,
      accountName: names.get(t.accountId) ?? '',
      type: lower(t.type),
      amount: num(t.amount),
      currencyCode: t.currency ?? currencies.get(t.accountId),
      description: t.reference ?? '',
      date: new Date(t.occurredAt).toISOString(),
    }));
  }

  async listPeriods(tenantId: string) {
    const rows: any[] = await this.controls.listPeriods(tenantId);
    return rows.map((p: any) => ({
      id: p.id,
      name: p.name,
      startDate: new Date(p.startDate).toISOString(),
      endDate: new Date(p.endDate).toISOString(),
      status: p.isClosed ? 'closed' : 'open',
    }));
  }

  async listPaymentMethods(tenantId: string) {
    const rows: any[] = await this.controls.listPaymentMethods(tenantId);
    return rows.map((m: any) => ({ id: m.id, name: m.name, type: lower(m.code), active: m.isActive }));
  }

  async getSettings(tenantId: string) {
    const finance = await this.controls.getFinanceSettings(tenantId);
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
      const period = await tx.financialPeriod.findFirst({ where: { tenantId, isClosed: false }, orderBy: { startDate: 'desc' } });
      return {
        ...finance,
        academicYear: (year as any)?.name ?? '',
        currentPeriodId: period?.id ?? '',
        lateFeeEnabled: false,
        lateFeeAmount: 0,
      };
    });
  }

  async updateSettings(tenantId: string, dto: { currency?: string; receiptPrefix?: string; voucherPrefix?: string; graceDays?: number }) {
    return this.controls.updateFinanceSettings(tenantId, dto);
  }

  async createPeriod(tenantId: string, dto: { name: string; startDate: string; endDate: string }) {
    return this.controls.createPeriod(tenantId, dto);
  }

  async setPeriodLock(tenantId: string, userId: string, id: string, locked: boolean) {
    return this.controls.setPeriodLock(tenantId, userId, id, locked);
  }

  async setMethodActive(tenantId: string, id: string, isActive: boolean) {
    return this.controls.setMethodActive(tenantId, id, isActive);
  }

  async setMethodDetails(tenantId: string, id: string, dto: { accountName?: string; accountNumber?: string }) {
    return this.controls.setMethodDetails(tenantId, id, dto);
  }

  async listThresholds(tenantId: string) {
    return this.controls.listThresholds(tenantId);
  }

  async createThreshold(tenantId: string, dto: { module: string; threshold: number; approverRole: string }) {
    return this.controls.createThreshold(tenantId, dto);
  }

  async updateThreshold(tenantId: string, id: string, dto: { module?: string; threshold?: number; approverRole?: string; isActive?: boolean }) {
    return this.controls.updateThreshold(tenantId, id, dto);
  }

  async deleteThreshold(tenantId: string, id: string) {
    return this.controls.deleteThreshold(tenantId, id);
  }

  async getDashboard(tenantId: string) {
    // Pass the extended getStats shape straight through — every key the
    // dashboard page needs (outflows, headcounts, activity, tenant) must
    // reach the client unmapped.
    const stats: any = await this.dashboard.getStats(tenantId);
    // Outstanding fees: reuse the per-student schedule engine so the number
    // matches what each student's ledger shows (fees − paid − discounts),
    // never a separate estimate. Active students only, mirroring getStats.
    try {
      stats.outstandingFeeBalance = await this.prisma.withTenantRead(
        tenantId,
        async (tx: any) => {
          const students: any[] = await tx.student.findMany({
            where: { tenantId, status: 'ACTIVE' },
            select: { id: true },
          });
          const schedules = await this.buildSchedules(
            tx,
            tenantId,
            students.map((s: any) => s.id),
          );
          let outstanding = 0;
          for (const row of schedules.values()) outstanding += num(row.balance);
          return Math.round(outstanding * 100) / 100;
        },
      );
    } catch (err) {
      this.logger.warn(`Unable to compute outstanding fee balance: ${String(err)}`);
      stats.outstandingFeeBalance = null;
    }
    return stats;
  }

  async getCollectionsSummary(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const now = new Date();
      const months: { month: string; collected: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const agg = await tx.payment.aggregate({
          where: { tenantId, status: 'COMPLETED', paidAt: { gte: d, lt: next } },
          _sum: { amount: true },
        });
        months.push({
          month: d.toLocaleString('en-US', { month: 'short' }),
          collected: Math.round(num(agg._sum.amount) * 100) / 100,
        });
      }
      return months;
    });
  }

  async getFinancialProfiles(tenantId: string) {
    return this.prisma.withTenantRead(tenantId, async (tx) => {
      const [students, paidGroups, credits] = await Promise.all([
        tx.student.findMany({
          where: { tenantId },
          select: { id: true, firstName: true, lastName: true, educationLevel: true, grade: true },
          orderBy: { firstName: 'asc' },
          take: 500,
        }),
        tx.payment.groupBy({
          by: ['studentId'],
          where: { tenantId, status: 'COMPLETED' },
          _sum: { amount: true },
        }),
        tx.studentCreditBalance.findMany({ where: { tenantId } }),
      ]);
      const paidBy = new Map<string, number>(
        paidGroups.map((g: any) => [g.studentId, Math.round(num(g._sum.amount) * 100) / 100]),
      );
      const creditBy = new Map<string, number>(
        credits.map((c: any) => [c.studentId, Math.round(num(c.balance) * 100) / 100]),
      );
      return students.map((s: any) => ({
        id: s.id,
        name: this.fullName(s),
        grade: [s.educationLevel, s.grade].filter(Boolean).join(' ') || '',
        totalPaid: paidBy.get(s.id) ?? 0,
        creditBalance: creditBy.get(s.id) ?? 0,
      }));
    });
  }

  // Private method to generate receipt PDF
  private async generateReceiptPdf(data: {
    paymentId: string;
    paymentReference: string | null;
    studentName: string;
    studentId: string;
    amount: number;
    currencyCode: string;
    method: string;
    paidAt: Date;
    receiptIssuedAt: Date;
    allocations: { kind: string; installmentNo: number | null; amount: number; installmentName: string }[];
    discounts: { label: string; amount: number }[];
    totalDiscount: number;
    notes: string | null;
  }): Promise<Buffer> {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const money = (n: number) => `${data.currencyCode} ${n.toFixed(2)}`;
    // Explicit locale, matching the payslip renderer — never the server default.
    const fmtDate = (d: Date) =>
      d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    // Header
    doc.fontSize(18).text('Payment Receipt');
    doc.fontSize(11).fillColor('#555555').text(`Payment ID: ${data.paymentId}`);
    doc.moveDown();

    // Student info
    doc.fillColor('#000000').fontSize(11);
    doc.text(`Student: ${data.studentName} (${data.studentId})`);
    doc.text(`Payment Date: ${fmtDate(data.paidAt)}`);
    doc.text(`Receipt Issued: ${fmtDate(data.receiptIssuedAt)}`);
    doc.text(`Method: ${data.method}${data.paymentReference ? ` • Ref: ${data.paymentReference}` : ''}`);
    doc.moveDown();

    // Allocations table
    const colLabel = 48;
    const colAmount = 400;
    let y = doc.y;

    doc.fontSize(11).fillColor('#555555');
    doc.text('Allocation', 48, y);
    doc.text('Amount', 400, y, { width: 100, align: 'right' });
    y += 18;
    doc.strokeColor('#cccccc').lineWidth(1).moveTo(48, y - 4).lineTo(595 - 48, y - 4).stroke();
    y += 2;

    doc.fillColor('#000000').fontSize(11);
    let subtotal = 0;
    for (const alloc of data.allocations) {
      doc.text(alloc.installmentName, 48, y, { width: 340 });
      const amt = money(alloc.amount);
      doc.text(amt, 400, y, { width: 100, align: 'right' });
      subtotal += alloc.amount;
      y += 18;
    }

    // Subtotal line
    doc.strokeColor('#cccccc').lineWidth(1).moveTo(48, y - 4).lineTo(595 - 48, y - 4).stroke();
    y += 4;
    doc.fontSize(11).text('Total', 48, y);
    doc.text(money(subtotal), 400, y, { width: 100, align: 'right' });
    y += 24;

    // Discounts applied with this payment (reductions, not cash collected).
    if (data.discounts.length) {
      doc.fontSize(11).fillColor('#555555').text('Discounts applied', 48, y);
      y += 18;
      doc.fillColor('#000000').fontSize(11);
      for (const d of data.discounts) {
        doc.text(d.label, 48, y, { width: 340 });
        doc.text(`− ${money(d.amount)}`, 400, y, { width: 100, align: 'right' });
        y += 18;
      }
      y += 6;
    }

    // Notes
    if (data.notes) {
      doc.fontSize(9).fillColor('#777777').text(`Notes: ${data.notes}`);
    }

    // Footer — print time of this copy, distinct from the stable issue date above.
    doc.moveDown(2);
    doc.fontSize(9).fillColor('#777777');
    doc.text(`Printed ${new Date().toLocaleString('en-GB')} · System-generated receipt.`);

    doc.end();
    return done;
  }
}


