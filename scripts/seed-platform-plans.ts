// Seeds the platform tier catalogue.
//
//   npm run seed:plans            # add missing tiers, leave edited ones alone
//   npm run seed:plans -- --force  # overwrite every tier from the catalogue
//
// The catalogue lives in src/platform/platform-plan-tiers.ts, so this script
// and the console read the same numbers. Existing rows are NOT overwritten
// by default: the console can edit a tier's features and limits, and a
// re-seed must not silently undo that. Use --force when the catalogue is
// the intended source of truth (a price change, for example).
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

import { PLAN_TIERS } from '../src/platform/platform-plan-tiers';

const force = process.argv.includes('--force');

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  let created = 0;
  let updated = 0;
  let kept = 0;

  for (const tier of PLAN_TIERS) {
    const data = {
      name: tier.name,
      tier: tier.tier,
      target: tier.target,
      billingModel: tier.billingModel,
      price: tier.price,
      priceMax: tier.priceMax,
      currency: tier.currency,
      durationDays: tier.durationDays,
      sortOrder: tier.sortOrder,
      includedModules: tier.includedModules,
      features: tier.features,
      isActive: true,
    };

    const existing = await prisma.platformPlan.findUnique({
      where: { code: tier.code },
    });

    if (!existing) {
      await prisma.platformPlan.create({ data: { code: tier.code, ...data } });
      created += 1;
      console.log(`created ${tier.code} (${tier.name})`);
      continue;
    }

    if (!force) {
      kept += 1;
      console.log(
        `kept ${tier.code} (already exists; use --force to overwrite)`,
      );
      continue;
    }

    await prisma.platformPlan.update({ where: { code: tier.code }, data });
    updated += 1;
    console.log(`updated ${tier.code}`);
  }

  console.log(
    `\n${created} created, ${updated} updated, ${kept} left as they were`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
