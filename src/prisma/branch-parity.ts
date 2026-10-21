// Branch schema parity: pure snapshot diff used by scripts/check-branch-parity.
// Compares production (source of truth for deploys) against the test branch
// (what the dev server actually runs on). Any difference in either direction
// is drift: prod-only objects break dev, test-only objects break the next
// production deploy.

export interface ColumnSnapshot {
  name: string;
  // Normalized data type (information_schema data_type or udt name).
  type: string;
  nullable: boolean;
  hasDefault: boolean;
}

export interface TableSnapshot {
  columns: ColumnSnapshot[];
  // Index names (pg_indexes) for the table.
  indexes: string[];
  // Foreign-key constraint names (pg_constraint) for the table.
  constraints: string[];
}

export interface SchemaSnapshot {
  tables: Record<string, TableSnapshot>;
  // Enum name -> sorted labels.
  enums: Record<string, string[]>;
}

export interface Drift {
  message: string;
}

function describeColumn(c: ColumnSnapshot): string {
  return `${c.type} ${c.nullable ? 'NULL' : 'NOT NULL'}`;
}

export function diffSnapshots(prod: SchemaSnapshot, test: SchemaSnapshot): Drift[] {
  const drift: Drift[] = [];

  for (const table of Object.keys(prod.tables)) {
    const testTable = test.tables[table];
    if (!testTable) {
      drift.push({
        message: `table "${table}" exists in production but is missing from the test branch`,
      });
      continue;
    }

    const prodTable = prod.tables[table];
    const testColumns = new Map(testTable.columns.map((c) => [c.name, c]));
    for (const column of prodTable.columns) {
      const match = testColumns.get(column.name);
      if (!match) {
        drift.push({
          message: `column "${table}.${column.name}" exists in production but is missing from the test branch`,
        });
      } else if (
        match.type !== column.type ||
        match.nullable !== column.nullable
      ) {
        drift.push({
          message: `column "${table}.${column.name}" differs (production: ${describeColumn(column)}, test: ${describeColumn(match)})`,
        });
      }
    }
    for (const column of testTable.columns) {
      if (!prodTable.columns.some((c) => c.name === column.name)) {
        drift.push({
          message: `column "${table}.${column.name}" exists on the test branch but is missing from production`,
        });
      }
    }

    for (const index of prodTable.indexes) {
      if (!testTable.indexes.includes(index)) {
        drift.push({
          message: `index "${index}" on "${table}" exists in production but is missing from the test branch`,
        });
      }
    }
    for (const index of testTable.indexes) {
      if (!prodTable.indexes.includes(index)) {
        drift.push({
          message: `index "${index}" on "${table}" exists on the test branch but is missing from production`,
        });
      }
    }

    for (const constraint of prodTable.constraints) {
      if (!testTable.constraints.includes(constraint)) {
        drift.push({
          message: `constraint "${constraint}" on "${table}" exists in production but is missing from the test branch`,
        });
      }
    }
    for (const constraint of testTable.constraints) {
      if (!prodTable.constraints.includes(constraint)) {
        drift.push({
          message: `constraint "${constraint}" on "${table}" exists on the test branch but is missing from production`,
        });
      }
    }
  }
  for (const table of Object.keys(test.tables)) {
    if (!prod.tables[table]) {
      drift.push({
        message: `table "${table}" exists on the test branch but is missing from production`,
      });
    }
  }

  for (const name of Object.keys(prod.enums)) {
    const testLabels = test.enums[name];
    if (!testLabels) {
      drift.push({
        message: `enum "${name}" exists in production but is missing from the test branch`,
      });
      continue;
    }
    for (const label of prod.enums[name]) {
      if (!testLabels.includes(label)) {
        drift.push({
          message: `enum value "${name}.${label}" exists in production but is missing from the test branch`,
        });
      }
    }
    for (const label of testLabels) {
      if (!prod.enums[name].includes(label)) {
        drift.push({
          message: `enum value "${name}.${label}" exists on the test branch but is missing from production`,
        });
      }
    }
  }
  for (const name of Object.keys(test.enums)) {
    if (!prod.enums[name]) {
      drift.push({
        message: `enum "${name}" exists on the test branch but is missing from production`,
      });
    }
  }

  return drift;
}
