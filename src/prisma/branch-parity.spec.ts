import { diffSnapshots, type SchemaSnapshot } from './branch-parity';

function table(columns: string[] = [], indexes: string[] = [], constraints: string[] = []): SchemaSnapshot['tables'][string] {
  return {
    columns: columns.map((name) => ({ name, type: 'uuid', nullable: true, hasDefault: false })),
    indexes,
    constraints,
  };
}

function snapshot(
  tables: Record<string, SchemaSnapshot['tables'][string]> = {},
  enums: Record<string, string[]> = {},
): SchemaSnapshot {
  return { tables, enums };
}

describe('diffSnapshots (branch schema parity)', () => {
  it('reports no drift for identical snapshots', () => {
    const snap = snapshot(
      { exams: table(['id', 'name'], ['exams_pkey'], []) },
      { exam_status: ['DRAFT', 'PUBLISHED'] },
    );

    expect(diffSnapshots(snap, snapshot(
      { exams: table(['id', 'name'], ['exams_pkey'], []) },
      { exam_status: ['DRAFT', 'PUBLISHED'] },
    ))).toEqual([]);
  });

  it('reports a table missing from the test branch', () => {
    const drift = diffSnapshots(
      snapshot({ exams: table(['id']), exam_types: table(['id']) }),
      snapshot({ exams: table(['id']) }),
    );

    expect(drift.map((d) => d.message)).toContain(
      'table "exam_types" exists in production but is missing from the test branch',
    );
  });

  it('reports a table present only on the test branch', () => {
    const drift = diffSnapshots(
      snapshot({ exams: table(['id']) }),
      snapshot({ exams: table(['id']), scratch_table: table(['id']) }),
    );

    expect(drift.map((d) => d.message)).toContain(
      'table "scratch_table" exists on the test branch but is missing from production',
    );
  });

  it('reports a column missing from the test branch', () => {
    const drift = diffSnapshots(
      snapshot({ exams: table(['id', 'author_id']) }),
      snapshot({ exams: table(['id']) }),
    );

    expect(drift.map((d) => d.message)).toContain(
      'column "exams.author_id" exists in production but is missing from the test branch',
    );
  });

  it('reports a column type mismatch', () => {
    const prod = snapshot({ exams: { columns: [{ name: 'name', type: 'varchar', nullable: false, hasDefault: false }], indexes: [], constraints: [] } });
    const test = snapshot({ exams: { columns: [{ name: 'name', type: 'text', nullable: false, hasDefault: false }], indexes: [], constraints: [] } });

    const drift = diffSnapshots(prod, test);

    expect(drift.map((d) => d.message)).toContain(
      'column "exams.name" differs (production: varchar NOT NULL, test: text NOT NULL)',
    );
  });

  it('reports a missing enum value', () => {
    const drift = diffSnapshots(
      snapshot({}, { exam_status: ['DRAFT', 'MARKS_OPEN'] }),
      snapshot({}, { exam_status: ['DRAFT'] }),
    );

    expect(drift.map((d) => d.message)).toContain(
      'enum value "exam_status.MARKS_OPEN" exists in production but is missing from the test branch',
    );
  });

  it('reports a missing index and a missing constraint', () => {
    const drift = diffSnapshots(
      snapshot({ exams: table(['id'], ['exams_group_idx'], ['exams_author_id_fkey']) }),
      snapshot({ exams: table(['id'], [], []) }),
    );
    const messages = drift.map((d) => d.message);

    expect(messages).toContain(
      'index "exams_group_idx" on "exams" exists in production but is missing from the test branch',
    );
    expect(messages).toContain(
      'constraint "exams_author_id_fkey" on "exams" exists in production but is missing from the test branch',
    );
  });
});
