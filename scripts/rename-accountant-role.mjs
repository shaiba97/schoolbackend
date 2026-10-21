// One-off data fix: the dev tenant's custom ACCOUNTANT role was minted with
// the literal name 'ACCOUNTANT'; rename it to the human-facing position title.
// Slug is untouched — no auth impact.
//
// Usage:
//   node scripts/rename-accountant-role.mjs [tenantId]

import { readFileSync } from 'node:fs';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const DATABASE_URL = env
  .split('\n')
  .find((l) => l.startsWith('DATABASE_URL='))
  ?.slice('DATABASE_URL='.length)
  ?.trim()
  ?.replace(/^["']|["']$/g, '');
if (!DATABASE_URL) throw new Error('DATABASE_URL not found in backend/.env');

const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: DATABASE_URL }) });

const tenantId = process.argv[2] || '11111111-1111-4111-8111-111111111111';
const slug = 'CUSTOM_ACCOUNTANT';
const name = 'Financial Affairs (Accountant)';

const before = await prisma.role.findFirst({ where: { tenantId, slug } });
if (!before) {
  console.log(`not found: role ${slug} (tenant ${tenantId})`);
  process.exit(0);
}
console.log(`before: id=${before.id} name="${before.name}" slug=${before.slug}`);

if (before.name === name) {
  console.log('already renamed — nothing to do');
  process.exit(0);
}

const updated = await prisma.role.update({
  where: { id: before.id },
  data: { name },
});
console.log(`after:  id=${updated.id} name="${updated.name}" slug=${updated.slug}`);

await prisma.$disconnect();
process.exit(0);
