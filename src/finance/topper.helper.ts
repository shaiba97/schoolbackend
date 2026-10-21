export interface TopperMarkRow {
  studentId: string;
  classId: string;
  marks: number | null;
  kind: 'MAJOR' | 'CASUAL';
  status: string;
}

export interface TopperRosterEntry {
  studentId: string;
  classId: string;
}

export interface ClassTopper {
  classId: string;
  studentId: string;
  totalMarks: number;
}

/**
 * Pure ranking for the Topper-of-Class discount.
 *
 * Only `kind = MAJOR` rows with `status = PUBLISHED` and non-null marks count
 * (CASUAL rows are low-stakes makeup noise — see DECISIONS.md). Marks are
 * summed per (class, student) across the exam's subjects, then each class's
 * rank-1 total wins. The roster is the ACTIVE enrollment list: rows for
 * students not enrolled in that class are ignored, and a class with no
 * qualifying marks yields no winner. Ties share rank 1 (multiple winners).
 * Output is deterministic: classes ascending, ties by studentId.
 */
export function computeClassToppers(
  rows: TopperMarkRow[],
  roster: TopperRosterEntry[],
): ClassTopper[] {
  const enrolled = new Set(roster.map((r) => `${r.classId}|${r.studentId}`));

  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== 'MAJOR') continue;
    if (row.status !== 'PUBLISHED') continue;
    if (row.marks == null || !(row.marks >= 0)) continue;
    if (!enrolled.has(`${row.classId}|${row.studentId}`)) continue;
    const key = `${row.classId}|${row.studentId}`;
    totals.set(key, (totals.get(key) ?? 0) + row.marks);
  }

  const byClass = new Map<string, Array<{ studentId: string; total: number }>>();
  for (const [key, total] of totals) {
    const sep = key.indexOf('|');
    const classId = key.slice(0, sep);
    const studentId = key.slice(sep + 1);
    const list = byClass.get(classId) ?? [];
    list.push({ studentId, total });
    byClass.set(classId, list);
  }

  const winners: ClassTopper[] = [];
  for (const [classId, list] of byClass) {
    const best = Math.max(...list.map((l) => l.total));
    const tied = list
      .filter((l) => l.total === best)
      .sort((a, b) => (a.studentId < b.studentId ? -1 : 1));
    for (const t of tied) {
      winners.push({ classId, studentId: t.studentId, totalMarks: t.total });
    }
  }
  winners.sort((a, b) =>
    a.classId !== b.classId
      ? a.classId < b.classId
        ? -1
        : 1
      : a.studentId < b.studentId
        ? -1
        : 1,
  );
  return winners;
}
