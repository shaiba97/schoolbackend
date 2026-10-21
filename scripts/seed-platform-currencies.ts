// Seeds the platform currency table.
//
//   npm run seed:currencies            # add missing currencies, keep edited rates
//   npm run seed:currencies -- --force  # reset every rate to the catalogue default
//
// The catalogue lives in src/platform/platform-currency-catalogue.ts, so the
// seed and the console agree on the supported markets. An existing row keeps
// its rate unless --force is passed, because a rate is data an operator may
// have corrected by hand.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

import { CURRENCY_CATALOGUE } from '../src/platform/platform-currency-catalogue';

const force = process.argv.includes('--force');

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  let created = 0;
  let reset = 0;
  let kept = 0;

  for (const currency of CURRENCY_CATALOGUE) {
    const data = {
      name: currency.name,
      countryCode: currency.countryCode,
      symbol: currency.symbol,
      autoSync: currency.autoSync,
      isActive: true,
    };

    const existing = await prisma.platformCurrency.findUnique({
      where: { code: currency.code },
    });

    if (!existing) {
      await prisma.platformCurrency.create({
        data: {
          code: currency.code,
          rateToUsd: currency.defaultRateToUsd,
          ...data,
        },
      });
      created += 1;
      console.log(`created ${currency.code} at ${currency.defaultRateToUsd}`);
      continue;
    }

    if (!force) {
      kept += 1;
      console.log(
        `kept ${currency.code} (rate ${String(existing.rateToUsd)}); use --force to reset`,
      );
      continue;
    }

    await prisma.platformCurrency.update({
      where: { code: currency.code },
      data: { ...data, rateToUsd: currency.defaultRateToUsd },
    });
    reset += 1;
    console.log(`reset ${currency.code} to ${currency.defaultRateToUsd}`);
  }

  console.log(
    `\n${created} created, ${reset} reset, ${kept} left as they were`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
