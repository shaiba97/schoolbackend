import { computeClassToppers } from './topper.helper';

const ROSTER = [
  { studentId: 's1', classId: 'c1' },
  { studentId: 's2', classId: 'c1' },
  { studentId: 's3', classId: 'c1' },
  { studentId: 's4', classId: 'c2' },
  { studentId: 's5', classId: 'c2' },
];

describe('computeClassToppers', () => {
  it('picks the single highest MAJOR+PUBLISHED total per class', () => {
    const winners = computeClassToppers(
      [
        { studentId: 's1', classId: 'c1', marks: 80, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's2', classId: 'c1', marks: 95, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's3', classId: 'c1', marks: 70, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's4', classId: 'c2', marks: 60, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's5', classId: 'c2', marks: 61, kind: 'MAJOR', status: 'PUBLISHED' },
      ],
      ROSTER,
    );
    expect(winners).toEqual([
      { classId: 'c1', studentId: 's2', totalMarks: 95 },
      { classId: 'c2', studentId: 's5', totalMarks: 61 },
    ]);
  });

  it('sums multiple subject rows per student before ranking', () => {
    const winners = computeClassToppers(
      [
        { studentId: 's1', classId: 'c1', marks: 80, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's1', classId: 'c1', marks: 70, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's2', classId: 'c1', marks: 95, kind: 'MAJOR', status: 'PUBLISHED' },
      ],
      ROSTER,
    );
    expect(winners).toEqual([{ classId: 'c1', studentId: 's1', totalMarks: 150 }]);
  });

  it('shares rank 1 on ties (same class, multiple winners)', () => {
    const winners = computeClassToppers(
      [
        { studentId: 's1', classId: 'c1', marks: 90, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's2', classId: 'c1', marks: 90, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's3', classId: 'c1', marks: 10, kind: 'MAJOR', status: 'PUBLISHED' },
      ],
      ROSTER,
    );
    expect(winners).toEqual([
      { classId: 'c1', studentId: 's1', totalMarks: 90 },
      { classId: 'c1', studentId: 's2', totalMarks: 90 },
    ]);
  });

  it('ignores CASUAL, non-PUBLISHED, and null-mark rows', () => {
    const winners = computeClassToppers(
      [
        { studentId: 's1', classId: 'c1', marks: 200, kind: 'CASUAL', status: 'PUBLISHED' },
        { studentId: 's1', classId: 'c1', marks: 200, kind: 'MAJOR', status: 'DRAFT' },
        { studentId: 's1', classId: 'c1', marks: null, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's2', classId: 'c1', marks: 40, kind: 'MAJOR', status: 'PUBLISHED' },
      ],
      ROSTER,
    );
    expect(winners).toEqual([{ classId: 'c1', studentId: 's2', totalMarks: 40 }]);
  });

  it('ignores result rows for students not on the ACTIVE roster', () => {
    const winners = computeClassToppers(
      [
        { studentId: 'ghost', classId: 'c1', marks: 999, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's1', classId: 'c1', marks: 50, kind: 'MAJOR', status: 'PUBLISHED' },
      ],
      ROSTER,
    );
    expect(winners).toEqual([{ classId: 'c1', studentId: 's1', totalMarks: 50 }]);
  });

  it('awards no winner for a class with no qualifying marks', () => {
    const winners = computeClassToppers(
      [
        { studentId: 's1', classId: 'c1', marks: 50, kind: 'MAJOR', status: 'PUBLISHED' },
        { studentId: 's4', classId: 'c2', marks: 10, kind: 'CASUAL', status: 'PUBLISHED' },
      ],
      ROSTER,
    );
    expect(winners).toEqual([{ classId: 'c1', studentId: 's1', totalMarks: 50 }]);
  });

  it('returns [] for empty input', () => {
    expect(computeClassToppers([], ROSTER)).toEqual([]);
    expect(computeClassToppers([], [])).toEqual([]);
  });
});
