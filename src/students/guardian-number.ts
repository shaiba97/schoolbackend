// Guardian numbers: YY + CPG + 4-digit yearly sequence.
// e.g. `26CPG0001` — 2026, Comboni Portsudan Guardian, first guardian issued
// that year. Mirrors the teacher employee-number scheme (`employee-number.ts`):
//
// - CPG is fixed (Comboni Portsudan Guardian), never derived from tenant data.
// - Sequence resets every calendar year; max 9999 per year, then a clear
//   error (no silent 5-digit overflow).
// - Issue order walks forward from 1 past taken numbers: gaps left by
//   deletions are reused, keeping the yearly sequence dense.
//   No counter row to lock or desync.
// - Explicitly provided numbers bypass generation entirely (backfill-safe);
//   the `@@unique([tenantId, guardianNumber])` constraint remains the final
//   backstop, including for races.

export const GUARDIAN_NUMBER_INFIX = 'CPG';
export const GUARDIAN_NUMBER_MAX_SEQ = 9999;

export function formatGuardianNumber(year: number, seq: number): string {
  return `${String(year).slice(-2)}${GUARDIAN_NUMBER_INFIX}${String(seq).padStart(4, '0')}`;
}

export async function generateGuardianNumber(
  tx: any,
  tenantId: string,
  year: number = new Date().getFullYear(),
): Promise<string> {
  const prefix = `${String(year).slice(-2)}${GUARDIAN_NUMBER_INFIX}`;
  // Compare in JS: DB lexicographic ordering is unreliable for mixed legacy
  // rows, and non-numeric rows must not be counted as issued numbers.
  const candidates = await tx.guardian.findMany({
    where: { tenantId, guardianNumber: { startsWith: prefix } },
    select: { guardianNumber: true },
  });
  const taken = new Set<string>();
  for (const row of candidates) {
    if (row.guardianNumber) taken.add(row.guardianNumber);
  }
  // Walk forward from 1: gaps left by deletions are reused, keeping the
  // yearly sequence dense. No counter row to lock or desync.
  let seq = 1;
  while (seq <= GUARDIAN_NUMBER_MAX_SEQ && taken.has(formatGuardianNumber(year, seq))) {
    seq += 1;
  }
  if (seq > GUARDIAN_NUMBER_MAX_SEQ) {
    throw new Error(`Guardian numbers for ${year} are exhausted (max ${GUARDIAN_NUMBER_MAX_SEQ})`);
  }
  return formatGuardianNumber(year, seq);
}
