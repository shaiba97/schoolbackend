// Branch schema parity check: production (deploy target) vs the test branch
// (what `backend/.env` points at and the dev server runs on).
//
// Run after every migration apply:
//   npm run db:parity
//
// Needs PROD_DATABASE_URL in the environment (copy it from the Neon console;
// it is intentionally NOT stored in .env so dev can never write to prod).
// The test-branch URL comes from .env (DATABASE_URL_UNPOOLED).
// Exit 0 = in sync, exit 1 = drift found (or misconfiguration).

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import {
  diffSnapshots,
  type ColumnSnapshot,
  type SchemaSnapshot,
} from '../src/prisma/branch-parity';

interface ColumnRow {
  table_name: string;
  column_name: string;
  type_name: string;
  is_nullable: string;
  has_default: boolean;
}

interface EnumRow {
  typname: string;
  enumlabel: string;
}

interface IndexRow {
  tablename: string;
  indexname: string;
}

interface ConstraintRow {
  table_name: string;
  conname: string;
}

const COLUMNS_SQL = `
SELECT c.table_name::text AS table_name, c.column_name::text AS column_name,
       c.udt_name::text AS type_name, c.is_nullable::text AS is_nullable,
       (c.column_default IS NOT NULL) AS has_default
FROM information_schema.tables t
JOIN information_schema.columns c
  ON c.table_name = t.table_name AND c.table_schema = t.table_schema
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY 1, c.ordinal_position`;

const ENUMS_SQL = `
SELECT t.typname::text AS typname, e.enumlabel::text AS enumlabel
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY 1, e.enumsortorder`;

const INDEXES_SQL = `
SELECT tablename::text AS tablename, indexname::text AS indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`;

const CONSTRAINTS_SQL = `
SELECT c.conrelid::regclass::text AS table_name, c.conname::text AS conname
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public' AND c.contype = 'f'
ORDER BY 1, 2`;

function toColumn(row: ColumnRow): ColumnSnapshot {
  return {
    name: row.column_name,
    type: row.type_name,
    nullable: row.is_nullable === 'YES',
    hasDefault: row.has_default,
  };
}

async function snapshot(client: PrismaClient, label: string): Promise<SchemaSnapshot> {
  async function run<T>(name: string, sql: string): Promise<T> {
    try {
      return (await client.$queryRawUnsafe(sql)) as T;
    } catch (cause) {
      throw new Error(`snapshot ${label}: query "${name}" failed: ${cause instanceof Error ? cause.message.split('\n')[0] : cause}`);
    }
  }
  const [columns, enums, indexes, constraints] = await Promise.all([
    run<ColumnRow[]>('columns', COLUMNS_SQL),
    run<EnumRow[]>('enums', ENUMS_SQL),
    run<IndexRow[]>('indexes', INDEXES_SQL),
    run<ConstraintRow[]>('constraints', CONSTRAINTS_SQL),
  ]);

  const tables: SchemaSnapshot['tables'] = {};
  for (const row of columns) {
    tables[row.table_name] ??= { columns: [], indexes: [], constraints: [] };
    tables[row.table_name].columns.push(toColumn(row));
  }
  for (const row of indexes) {
    if (tables[row.tablename]) tables[row.tablename].indexes.push(row.indexname);
  }
  for (const row of constraints) {
    if (tables[row.table_name]) tables[row.table_name].constraints.push(row.conname);
  }

  const enumMap: SchemaSnapshot['enums'] = {};
  for (const row of enums) {
    enumMap[row.typname] ??= [];
    enumMap[row.typname].push(row.enumlabel);
  }

  console.log(`snapshot: ${label}: ${Object.keys(tables).length} tables, ${Object.keys(enumMap).length} enums`);
  return { tables, enums: enumMap };
}

async function main() {
  const testUrl = process.env.DATABASE_URL_UNPOOLED;
  const prodUrl = process.env.PROD_DATABASE_URL;
  if (!testUrl) throw new Error('DATABASE_URL_UNPOOLED is not set (expected from .env)');
  if (!prodUrl) {
    throw new Error(
      'PROD_DATABASE_URL is not set. Copy the production connection string from the Neon console ' +
        '(it is deliberately kept out of .env so dev traffic can never hit production), e.g. ' +
        '$env:PROD_DATABASE_URL="postgresql://..." ; npm run db:parity',
    );
  }

  const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: prodUrl }) });
  const test = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testUrl }) });
  try {
    const [prodSnap, testSnap] = await Promise.all([
      snapshot(prod, 'production'),
      snapshot(test, 'test branch'),
    ]);
    const drift = diffSnapshots(prodSnap, testSnap);
    if (drift.length === 0) {
      console.log('parity: production and test branch schemas match');
      return;
    }
    console.error(`parity: ${drift.length} drift item(s) found (production vs test branch):`);
    for (const d of drift) console.error(`  - ${d.message}`);
    process.exitCode = 1;
  } finally {
    await Promise.all([prod.$disconnect(), test.$disconnect()]);
  }
}

main().catch((cause) => {
  console.error(`parity check failed: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
});
