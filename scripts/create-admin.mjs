import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const email = 'c@c.com';
const firstName = 'Daniel';
const lastName = 'Comboni';
const password = 'Comboni@123';

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`user ${email} already exists (id=${existing.id})`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, firstName, lastName, passwordHash },
    });

    const membership = await tx.tenantMembership.create({
      data: { tenantId: TENANT_ID, userId: user.id, status: 'ACTIVE' },
    });

    let role = await tx.role.findFirst({
      where: { tenantId: TENANT_ID, slug: 'ADMIN' },
    });

    if (!role) {
      role = await tx.role.create({
        data: {
          tenantId: TENANT_ID,
          name: 'Admin',
          slug: 'ADMIN',
          scope: 'TENANT',
          isSystemRole: true,
        },
      });
    }

    await tx.membershipRole.create({
      data: { membershipId: membership.id, roleId: role.id },
    });

    return { user, membership, role };
  });

  console.log(`created: ${result.user.email} | ${result.user.firstName} ${result.user.lastName} | role=${result.role.slug}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
