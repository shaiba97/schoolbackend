// Creates (or resumes) the super-admin control plane account.
//
//   node scripts/create-platform-admin.mjs [--email x --password y --name "Root"]
//
// Reads PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD / PLATFORM_ADMIN_NAME
// from the environment when flags are absent; falls back to dev defaults so
// local bootstrap is one command. The account is a plain User with an attached
// PlatformAdmin row (role SUPER_ADMIN, status ACTIVE) — no membership.
import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import * as bcrypt from 'bcrypt';

// .env holds the DATABASE_URL; dotenv is not loaded for a bare node script.
try {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="(.*)"$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* .env optional */
}

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const email = (arg('--email') || process.env.PLATFORM_ADMIN_EMAIL || 'root@platform.dev').toLowerCase();
const password = arg('--password') || process.env.PLATFORM_ADMIN_PASSWORD || 'Platform@12345';
const name = arg('--name') || process.env.PLATFORM_ADMIN_NAME || '';
const [firstName, ...rest] = name.split(' ');
const lastName = rest.join(' ') || undefined;

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { platformAdmin: true },
  });

  if (existing?.platformAdmin) {
    console.log(`platform admin ${email} already exists (adminId=${existing.platformAdmin.id})`);
    return;
  }

  if (existing) {
    // Attach the platform record to the existing user.
    const admin = await prisma.platformAdmin.create({
      data: { userId: existing.id, role: 'SUPER_ADMIN', status: 'ACTIVE' },
    });
    console.log(`platform role attached to existing user ${email} (adminId=${admin.id})`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      firstName: firstName || 'Root',
      lastName,
      passwordHash,
    },
  });

  const admin = await prisma.platformAdmin.create({
    data: { userId: user.id, role: 'SUPER_ADMIN', status: 'ACTIVE' },
  });

  console.log(`created platform admin ${email} (userId=${user.id}, adminId=${admin.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
