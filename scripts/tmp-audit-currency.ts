import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const entries = await prisma.platformAuditLog.findMany({
    where: { action: 'platform.currency.updated' },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });
  for (const entry of entries) {
    console.log(
      `${entry.createdAt.toISOString().slice(0, 19)}  ${JSON.stringify(entry.newValues)}`,
    );
  }
  const current = await prisma.platformCurrency.findMany({
    orderBy: { code: 'asc' },
    select: { code: true, rateToUsd: true, lastSyncedAt: true },
  });
  console.log('\ncurrent:');
  for (const c of current) {
    console.log(
      `  ${c.code.padEnd(4)} rate=${String(c.rateToUsd).padStart(10)} synced=${c.lastSyncedAt?.toISOString().slice(0, 19) ?? 'never'}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e.message?.slice(0, 200));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
