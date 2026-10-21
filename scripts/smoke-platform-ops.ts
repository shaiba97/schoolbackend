// Platform audit + announcement smoke test against the real database.
//
//   npx ts-node scripts/smoke-platform-ops.ts
//
// Verifies the audit trail is written by real mutations and that announcements
// can be published and withdrawn. The announcement created here is removed
// again so the platform is left as it was found.
import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthModule } from '../src/auth/auth.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PlatformAuthController } from '../src/platform/platform-auth.controller';
import { PlatformAdminGuard } from '../src/platform/platform-admin.guard';
import { PlatformRoleGuard } from '../src/platform/platform-role.guard';
import { PlatformAuditController } from '../src/platform/platform-audit.controller';
import { PlatformAnnouncementsController } from '../src/platform/platform-announcements.controller';
import { PlatformAuthService } from '../src/platform/platform-auth.service';
import { PlatformOpsService } from '../src/platform/platform-ops.service';

const EMAIL = (process.env.PLATFORM_ADMIN_EMAIL || 'root@platform.dev').toLowerCase();
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD || 'Platform@12345';

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
}

async function main() {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule],
    controllers: [
      PlatformAuthController,
      PlatformAuditController,
      PlatformAnnouncementsController,
    ],
    providers: [
      PlatformAuthService,
      PlatformOpsService,
      PlatformAdminGuard,
      PlatformRoleGuard,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.setGlobalPrefix('api');
  await app.init();
  const server = app.getHttpServer();
  const prisma = app.get(PrismaService);

  console.log('\nplatform ops (audit + announcements) smoke test');

  const login = await request(server)
    .post('/api/platform/auth/login')
    .send({ email: EMAIL, password: PASSWORD });
  const token = login.body?.accessToken as string;
  check('platform login succeeds', login.status === 201 && Boolean(token));
  if (!token) {
    await app.close();
    process.exitCode = 1;
    return;
  }
  const auth = `Bearer ${token}`;

  const audit = await request(server)
    .get('/api/platform/audit?limit=10')
    .set('Authorization', auth);
  check('audit log returns 200', audit.status === 200, `status=${audit.status}`);
  check(
    'audit entries carry actor and school names',
    Array.isArray(audit.body?.items) &&
      audit.body.items.every(
        (entry: { actorName: string | null; tenantName: string | null }) =>
          "actorName" in entry && "tenantName" in entry,
      ),
    JSON.stringify(audit.body?.items?.[0]),
  );

  const filtered = await request(server)
    .get('/api/platform/audit?action=tenant.status')
    .set('Authorization', auth);
  check(
    'audit log filters by action',
    filtered.status === 200 &&
      (filtered.body?.items ?? []).every((entry: { action: string }) =>
        entry.action.toLowerCase().includes("tenant.status"),
      ),
    `status=${filtered.status}`,
  );

  const created = await request(server)
    .post('/api/platform/announcements')
    .set('Authorization', auth)
    .send({
      title: 'Smoke test announcement',
      body: 'Created by the platform smoke test.',
      severity: 'INFO',
    });
  check(
    'announcement is published',
    created.status === 201 && Boolean(created.body?.id),
    `status=${created.status} body=${JSON.stringify(created.body)}`,
  );
  const announcementId = created.body?.id as string;

  const listed = await request(server)
    .get('/api/platform/announcements')
    .set('Authorization', auth);
  check(
    'announcement appears in the list',
    listed.status === 200 &&
      (listed.body ?? []).some((row: { id: string }) => row.id === announcementId),
    `status=${listed.status}`,
  );

  const withdrawn = await request(server)
    .patch(`/api/platform/announcements/${announcementId}`)
    .set('Authorization', auth)
    .send({ isActive: false });
  check(
    'announcement is withdrawn',
    withdrawn.status === 200 && withdrawn.body?.isActive === false,
    `status=${withdrawn.status}`,
  );

  const invalid = await request(server)
    .post('/api/platform/announcements')
    .set('Authorization', auth)
    .send({ title: 'x', body: 'y', severity: 'NOPE' });
  check('invalid announcement is rejected', invalid.status === 400, `status=${invalid.status}`);

  const auditAfter = await request(server)
    .get('/api/platform/audit?action=announcement')
    .set('Authorization', auth);
  check(
    'announcement changes are audited',
    auditAfter.status === 200 && (auditAfter.body?.items ?? []).length >= 2,
    `entries=${auditAfter.body?.items?.length}`,
  );

  if (announcementId) {
    await prisma.platformAuditLog.deleteMany({
      where: { entityId: announcementId },
    });
    await prisma.platformAnnouncement.delete({ where: { id: announcementId } });
  }

  await app.close();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
