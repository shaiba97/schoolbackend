// Puts every school on a yearly, billable term.
//
//   npx ts-node scripts/put-schools-on-yearly-terms.ts [--dry]
//
// Why this exists: the schools seeded during development carried a licence
// with no end date and no student count, which meant they never ended (no
// renewal, no lock) and were billed as if they had a single student. A
// platform that cannot charge cannot earn, so every licence gets:
//
//   - an end date a year out (the tier's term)
//   - the licensed student count the school actually has
//   - the per-student rate it is billed at (the tier price)
//
// A licence that already has all three is left alone. The script is
// idempotent: running it twice changes nothing the second time.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const dryRun = process.argv.includes('--dry');

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

/** A school with no students is still billed for a small school. */
const MINIMUM_STUDENTS = 50;

async function main() {
  const licences = await prisma.tenantLicense.findMany({
    include: {
      plan: true,
      tenant: { select: { id: true, name: true, _count: { select: { students: true } } } },
    },
  });

  let fixed = 0;
  let skipped = 0;

  for (const licence of licences) {
    const termDays = licence.plan.durationDays || 365;
    const students = Math.max(licence.tenant._count.students, MINIMUM_STUDENTS);
    const hasTerm = Boolean(licence.expiresAt);
    const hasStudents = Boolean(licence.seats);
    const hasRate = licence.pricePerStudent !== null;

    if (hasTerm && hasStudents && hasRate) {
      skipped += 1;
      continue;
    }

    const expiresAt =
      licence.expiresAt ?? new Date(Date.now() + termDays * 24 * 60 * 60 * 1000);
    const data = {
      expiresAt,
      seats: licence.seats ?? students,
      pricePerStudent: licence.pricePerStudent ?? licence.plan.price,
      status: 'ACTIVE' as const,
      terminatedAt: null,
      terminationReason: null,
    };

    if (dryRun) {
      console.log(
        `would set ${licence.tenant.name}: term ${expiresAt.toISOString().slice(0, 10)}, ${data.seats} students at ${data.pricePerStudent}`,
      );
    } else {
      await prisma.tenantLicense.update({ where: { id: licence.id }, data });
      await prisma.platformAuditLog.create({
        data: {
          action: 'platform.subscription.term_set',
          entityType: 'tenant_license',
          entityId: licence.id,
          tenantId: licence.tenantId,
          oldValues: {
            expiresAt: licence.expiresAt,
            seats: licence.seats,
            pricePerStudent: licence.pricePerStudent,
          },
          newValues: {
            expiresAt: data.expiresAt,
            seats: data.seats,
            pricePerStudent: data.pricePerStudent,
            planCode: licence.plan.code,
          },
        },
      });
    }

    fixed += 1;
    console.log(
      `${dryRun ? 'would set' : 'set'} ${licence.tenant.name}: term ${expiresAt.toISOString().slice(0, 10)}, ${data.seats} students at ${data.pricePerStudent}`,
    );
  }

  console.log(
    `\n${fixed} licence(s) ${dryRun ? 'would change' : 'changed'}, ${skipped} already on a yearly term`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
