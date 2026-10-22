// Shows what the platform is billing, school by school.
//
//   npx ts-node scripts/check-platform-billing.ts
//
// A quick read of the numbers that matter: which tier each school is on, the
// portals it has, the monthly amount it owes, and when its term ends. Useful
// after a pricing change or a migration of the licences.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const licences = await prisma.tenantLicense.findMany({
    include: {
      plan: { select: { code: true, name: true, price: true, billingModel: true } },
      tenant: {
        select: {
          id: true,
          name: true,
          status: true,
          modules: { select: { module: true, enabled: true } },
        },
      },
    },
    orderBy: { startedAt: 'desc' },
  });

  const seen = new Set<string>();
  let monthlyTotal = 0;

  console.log('school                     tier      rate     monthly   term ends   portals');
  for (const licence of licences) {
    if (seen.has(licence.tenantId)) continue;
    seen.add(licence.tenantId);

    const rate = Number(licence.yearlyPrice ?? licence.plan.price);
    const students = licence.seats ?? 0;
    const portals = licence.tenant.modules.filter((m) => m.enabled).length;
    monthlyTotal += rate;

    console.log(
      [
        licence.tenant.name.padEnd(26).slice(0, 26),
        (licence.plan.code ?? '-').padEnd(9),
        String(rate).padStart(7),
        `${rate}`.padStart(9),
        (licence.expiresAt?.toISOString().slice(0, 10) ?? 'never').padEnd(13),
        `${portals}/${licence.tenant.modules.length}`,
      ].join(' '),
    );
  }

  console.log(`\n${seen.size} school(s) on a licence`);
  console.log(`platform monthly recurring if all paid: ${monthlyTotal} USD`);

  const currencies = await prisma.platformCurrency.findMany({
    orderBy: { code: 'asc' },
    select: { code: true, rateToUsd: true, isActive: true },
  });
  console.log(
    `\ncurrencies: ${currencies.map((c) => `${c.code}@${c.rateToUsd}`).join('  ')}`,
  );
}

main()
  .catch((err) => {
    console.error('FAILED:', err.message?.slice(0, 300));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
