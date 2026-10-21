// Eligibility bridge: turns upstream approvals into payment-time
// DiscountEligibility rows. Shared by FinanceDiscountsService (sibling/manual
// queue) and FinancePayrollService (family condition) — both call these with
// their open `withTenant` transaction, so no service-to-service injection.
// The bridge is idempotent (keyed by sourceRefId) and never copies the
// sensitive family-condition `reason` onto the eligibility row.

export type DiscountSourceType = 'SIBLING' | 'TOPPER' | 'FAMILY_CONDITION' | 'MANUAL';
export type DeductionValueType = 'PERCENTAGE' | 'FIXED_AMOUNT';

const num = (v: unknown): number => Number(v ?? 0);

/** Sibling-sourced rows carry a relation marker. The sync writes the rule's
 *  relation (SISTERS/…); manual sibling assignment writes MANUAL_ASSIGN.
 *  Either way the row classifies (and bridges) as SIBLING. */
export function classifyStudentDiscountSource(row: {
  relationApplied?: string | null;
}): 'SIBLING' | 'MANUAL' {
  return row.relationApplied ? 'SIBLING' : 'MANUAL';
}

/**
 * DiscountType.kind is free text ('percentage' | 'fixed' set by the sibling
 * sync). Unknown kinds have no computable semantics — the bridge skips them
 * instead of inventing a meaning.
 */
export function discountValueTypeFromKind(kind: unknown): DeductionValueType | null {
  const k = String(kind ?? '').toLowerCase();
  if (k === 'percentage') return 'PERCENTAGE';
  if (k === 'fixed' || k === 'fixed_amount') return 'FIXED_AMOUNT';
  return null;
}

export function formatDiscountLabel(
  sourceType: DiscountSourceType,
  valueType: DeductionValueType,
  value: number,
  typeName?: string,
): string {
  if (sourceType === 'MANUAL') return typeName ?? 'Manual discount';
  if (sourceType === 'FAMILY_CONDITION') return 'Family condition';
  const shown = valueType === 'PERCENTAGE' ? `${value}%` : `${value}`;
  return `Sibling Discount (${shown})`;
}

export interface StudentDiscountApprovalInput {
  id: string;
  studentId: string;
  value: unknown;
  snapshotValue?: unknown;
  relationApplied?: string | null;
  discountTypeName?: string;
  discountTypeKind?: unknown;
}

export interface FamilyConditionApprovalInput {
  id: string;
  studentId: string;
  valueType: DeductionValueType;
  value: unknown;
  reason?: string;
}

async function insertIfAbsent(tx: any, tenantId: string, data: Record<string, unknown>) {
  const existing = await tx.discountEligibility.findFirst({
    where: { tenantId, sourceRefId: data.sourceRefId },
  });
  if (existing) return existing;
  return tx.discountEligibility.create({ data: { tenantId, ...data } });
}

export async function bridgeStudentDiscountApproval(
  tx: any,
  tenantId: string,
  row: StudentDiscountApprovalInput,
) {
  const sourceType = classifyStudentDiscountSource(row);
  const valueType = discountValueTypeFromKind(row.discountTypeKind);
  if (!valueType) return null;
  const value = num(row.snapshotValue ?? row.value);
  return insertIfAbsent(tx, tenantId, {
    studentId: row.studentId,
    sourceType,
    sourceRefId: row.id,
    valueType,
    value,
    label: formatDiscountLabel(sourceType, valueType, value, row.discountTypeName),
    academicYearId: null,
    expiresAt: null,
  });
}

export async function bridgeFamilyConditionApproval(
  tx: any,
  tenantId: string,
  row: FamilyConditionApprovalInput,
) {
  const value = num(row.value);
  return insertIfAbsent(tx, tenantId, {
    studentId: row.studentId,
    sourceType: 'FAMILY_CONDITION',
    sourceRefId: row.id,
    valueType: row.valueType,
    value,
    // Deliberately generic: the hardship `reason` is never copied here.
    label: formatDiscountLabel('FAMILY_CONDITION', row.valueType, value),
    academicYearId: null,
    expiresAt: null,
  });
}
