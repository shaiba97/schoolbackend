// Teacher employee IDs: YY + school code + department letter + sequence.
// e.g. `26CPM001` — 2026, school `CP` (Comboni Portsudan), Mathematics (`M`),
// first teacher issued for that department and year.
//
// - School code: fixed per school, from TEACHER_ID_SCHOOL_CODE (default `CP`).
//   Deliberately NOT derived from the tenant name — the code becomes part of
//   every ID ever issued, so renaming a school must not rewrite them.
// - Department letter: the first letter of the department's first word, so
//   "Mathematics" → M and "Arabic Language" → A. `X` marks a teacher with no
//   department (or an unnameable one).
// - Sequence: the number of IDs already issued for that exact prefix, plus
//   one — so the first teacher of a department+year is 001, the second 002,
//   the third 003. The count is then walked forward while the candidate is
//   already taken, which matters after a deletion: removing 002 leaves a count
//   of 2, and a plain "count + 1" would hand out 003 which is still in use.
//   Walking forward keeps every number unique while preserving the simple
//   001/002/003 progression. No counter row to lock or desync.
// - Explicitly provided numbers bypass generation entirely (backfill-safe);
//   the `@@unique([tenantId, employeeNumber])` constraint plus the callers'
//   P2002 mapping remain the final backstop, including for races.

export const DEFAULT_SCHOOL_CODE = 'CP';
const NO_DEPARTMENT_LETTER = 'X';

export function schoolCode(): string {
  const configured = process.env.TEACHER_ID_SCHOOL_CODE?.trim();
  if (!configured) return DEFAULT_SCHOOL_CODE;
  const letters = (configured.match(/[A-Za-z]/g) ?? []).join('').toUpperCase().slice(0, 3);
  return letters || DEFAULT_SCHOOL_CODE;
}

export function departmentCodeLetters(name: unknown): string {
  if (typeof name !== 'string') return NO_DEPARTMENT_LETTER;
  const firstWord = name.trim().split(/\s+/)[0] ?? '';
  const match = firstWord.match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : NO_DEPARTMENT_LETTER;
}

export function formatEmployeeNumber(
  year: number,
  code: string,
  letters: string,
  seq: number,
): string {
  return `${String(year).slice(-2)}${code}${letters}${String(seq).padStart(3, '0')}`;
}

export async function generateTeacherEmployeeNumber(
  tx: any,
  tenantId: string,
  departmentId?: string | null,
): Promise<string> {
  const year = new Date().getFullYear();
  const code = schoolCode();
  let letters = NO_DEPARTMENT_LETTER;
  if (departmentId) {
    const dept = await tx.department.findFirst({
      where: { id: departmentId, tenantId },
      select: { name: true },
    });
    if (dept) letters = departmentCodeLetters(dept.name);
  }
  const prefix = `${String(year).slice(-2)}${code}${letters}`;
  // Fetch candidates and compare in JS: DB lexicographic ordering is wrong for
  // variable-length prefixes (26CPM vs 26CPMA), and non-numeric legacy rows must
  // not be counted as issued numbers.
  const candidates = await tx.teacher.findMany({
    where: { tenantId, employeeNumber: { startsWith: prefix } },
    select: { employeeNumber: true },
  });
  const taken = new Set<string>();
  for (const row of candidates) {
    if (row.employeeNumber) taken.add(row.employeeNumber);
  }
  let seq = taken.size + 1;
  while (taken.has(formatEmployeeNumber(year, code, letters, seq))) {
    seq += 1;
  }
  return formatEmployeeNumber(year, code, letters, seq);
}
