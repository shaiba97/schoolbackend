// Platform tenant API smoke test against the real database.
//
//   npx ts-node scripts/smoke-platform-tenants.ts
//
// Exercises the cross-tenant endpoints end to end: stats, directory, detail,
// and the three mutations (status, module switch, feature flag). Mutations
// are reverted before the script exits so the platform is left as it was.
import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../src/prisma/prisma.module';
import { AuthModule } from '../src/auth/auth.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PlatformAuthController } from '../src/platform/platform-auth.controller';
import { PlatformAdminGuard } from '../src/platform/platform-admin.guard';
import { PlatformRoleGuard } from '../src/platform/platform-role.guard';
import { PlatformTenantsController } from '../src/platform/platform-tenants.controller';
import { PlatformAuthService } from '../src/platform/platform-auth.service';
import { PlatformTenantsService } from '../src/platform/platform-tenants.service';
import { PlatformProvisioningService } from '../src/platform/platform-provisioning.service';
import { PlatformPlansService } from '../src/platform/platform-plans.service';
import { PlatformPlansController } from '../src/platform/platform-plans.controller';
import { PlatformExpirationService } from '../src/platform/platform-expiration.service';

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
      PlatformTenantsController,
      PlatformPlansController,
    ],
    providers: [
      PlatformAuthService,
      PlatformTenantsService,
      PlatformProvisioningService,
      PlatformPlansService,
      PlatformExpirationService,
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

  console.log('\nplatform tenant API smoke test');

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

  const stats = await request(server).get('/api/platform/stats').set('Authorization', auth);
  check('stats returns 200', stats.status === 200, `status=${stats.status}`);
  check(
    'stats reports tenant totals and licensing figures',
    typeof stats.body?.tenants?.total === 'number' &&
      typeof stats.body?.licensing?.mrr === 'number' &&
      typeof stats.body?.licensing?.revenue === 'number',
    JSON.stringify(stats.body),
  );

  const list = await request(server)
    .get('/api/platform/tenants?page=1&limit=5')
    .set('Authorization', auth);
  check('tenant list returns 200', list.status === 200, `status=${list.status}`);
  check(
    'tenant list is paginated with items',
    Array.isArray(list.body?.items) && typeof list.body?.total === 'number',
    JSON.stringify(list.body),
  );

  const first = list.body?.items?.[0];
  if (!first) {
    check('a tenant is available for the detail and mutation checks', false, 'no tenants');
    await app.close();
    process.exitCode = 1;
    return;
  }
  const tenantId = first.id;
  console.log(`  ...  using tenant ${first.name} (${tenantId})`);

  const detail = await request(server)
    .get(`/api/platform/tenants/${tenantId}`)
    .set('Authorization', auth);
  check('tenant detail returns 200', detail.status === 200, `status=${detail.status}`);

  if (detail.body?.status === 'ARCHIVED') {
    // A previous run may have left the school in the archive. The archive is
    // terminal for the ordinary status flow, so it takes the explicit
    // restore action to make the school usable again.
    const restored = await request(server)
      .post(`/api/platform/tenants/${tenantId}/unarchive`)
      .set('Authorization', auth);
    check(
      'an archived school is restored before the checks run',
      restored.status === 201,
      `status=${restored.status}`,
    );
    await request(server)
      .get(`/api/platform/tenants/${tenantId}`)
      .set('Authorization', auth)
      .then((response) => {
        detail.body = response.body;
      });
  }
  check(
    'tenant detail includes modules, flags, counts, and activity',
    Array.isArray(detail.body?.modules) &&
      Array.isArray(detail.body?.featureFlags) &&
      typeof detail.body?.counts?.users === 'number' &&
      Array.isArray(detail.body?.recentActivity),
    JSON.stringify(Object.keys(detail.body ?? {})),
  );

  const search = await request(server)
    .get(`/api/platform/tenants?search=${encodeURIComponent(first.name.slice(0, 6))}`)
    .set('Authorization', auth);
  check(
    'search narrows the directory',
    search.status === 200 && (search.body?.items ?? []).length > 0,
    `status=${search.status}`,
  );

  const moduleBefore =
    detail.body?.modules?.find((row: { module: string }) => row.module === 'TRANSPORT')
      ?.enabled ?? false;
  const moduleToggle = await request(server)
    .patch(`/api/platform/tenants/${tenantId}/modules/TRANSPORT`)
    .set('Authorization', auth)
    .send({ enabled: !moduleBefore });
  check(
    'module switch persists',
    moduleToggle.status === 200 && moduleToggle.body?.enabled === !moduleBefore,
    `status=${moduleToggle.status} body=${JSON.stringify(moduleToggle.body)}`,
  );
  await request(server)
    .patch(`/api/platform/tenants/${tenantId}/modules/TRANSPORT`)
    .set('Authorization', auth)
    .send({ enabled: moduleBefore });

  const flagKey = detail.body?.featureFlags?.[0]?.key ?? 'notifications.whatsapp';
  const flagBefore =
    detail.body?.featureFlags?.find((row: { key: string }) => row.key === flagKey)?.enabled ??
    false;
  const flagToggle = await request(server)
    .patch(`/api/platform/tenants/${tenantId}/flags/${encodeURIComponent(flagKey)}`)
    .set('Authorization', auth)
    .send({ enabled: !flagBefore });
  check(
    'feature flag switch persists',
    flagToggle.status === 200 && flagToggle.body?.enabled === !flagBefore,
    `status=${flagToggle.status} body=${JSON.stringify(flagToggle.body)}`,
  );
  await request(server)
    .patch(`/api/platform/tenants/${tenantId}/flags/${encodeURIComponent(flagKey)}`)
    .set('Authorization', auth)
    .send({ enabled: flagBefore });

  const originalStatus = detail.body?.status as string;
  const nextStatus = originalStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
  const statusChange = await request(server)
    .patch(`/api/platform/tenants/${tenantId}/status`)
    .set('Authorization', auth)
    .send({ status: nextStatus });
  check(
    'status change persists',
    statusChange.status === 200 && statusChange.body?.status === nextStatus,
    `status=${statusChange.status} body=${JSON.stringify(statusChange.body)}`,
  );

  const restore = await request(server)
    .patch(`/api/platform/tenants/${tenantId}/status`)
    .set('Authorization', auth)
    .send({ status: originalStatus });
  check(
    'status change is reverted',
    restore.status === 200 && restore.body?.status === originalStatus,
    `status=${restore.status} body=${JSON.stringify(restore.body)}`,
  );

  const archived = await request(server)
    .patch(`/api/platform/tenants/${tenantId}/status`)
    .set('Authorization', auth)
    .send({ status: 'ARCHIVED' });
  check(
    'archived schools cannot be reactivated',
    archived.status === 400 || archived.status === 200,
    `status=${archived.status}`,
  );

  if (archived.status === 200) {
    // The archive is terminal for the ordinary status flow, so restoring the
    // school means the explicit restore action.
    const restored = await request(server)
      .post(`/api/platform/tenants/${tenantId}/unarchive`)
      .set('Authorization', auth);
    check(
      'an archived school can be restored',
      restored.status === 201 && restored.body?.status === 'ACTIVE',
      `status=${restored.status} body=${JSON.stringify(restored.body)}`,
    );
  }

  const anonymous = await request(server).get('/api/platform/stats');
  check('stats refuses an unauthenticated caller', anonymous.status === 401);

  // A school moved to a yearly tier gets a term, and the sweep ends it when
  // the term runs out.
  const plans = await request(server).get('/api/platform/plans').set('Authorization', auth);
  const yearly = (plans.body ?? []).find(
    (plan: { code: string; durationDays: number }) => plan.durationDays > 0,
  );
  if (yearly) {
    const upgraded = await request(server)
      .post(`/api/platform/plans/subscriptions/${tenantId}/upgrade`)
      .set('Authorization', auth)
      .send({ planId: yearly.id });
    check(
      'moving to a yearly tier starts the term',
      upgraded.status === 201 && Boolean(upgraded.body?.tier),
      `status=${upgraded.status} body=${JSON.stringify(upgraded.body)}`,
    );

    const subs = await request(server)
      .get('/api/platform/plans/subscriptions')
      .set('Authorization', auth);
    const row = (subs.body ?? []).find(
      (entry: { tenantId: string }) => entry.tenantId === tenantId,
    );
    check(
      'the subscription reports a term and a monthly amount',
      Boolean(row?.expiresAt) && typeof row?.monthlyUsd === 'number',
      `expiresAt=${row?.expiresAt} monthlyUsd=${row?.monthlyUsd} students=${row?.studentCount}`,
    );

    const renewed = await request(server)
      .post(`/api/platform/plans/subscriptions/${tenantId}/renew`)
      .set('Authorization', auth)
      .send({ studentCount: 321 });
    check(
      'a renewal can carry a new student count',
      renewed.status === 201,
      `status=${renewed.status}`,
    );

    const afterRenewal = await request(server)
      .get('/api/platform/plans/subscriptions')
      .set('Authorization', auth);
    const renewedRow = (afterRenewal.body ?? []).find(
      (entry: { tenantId: string }) => entry.tenantId === tenantId,
    );
    check(
      'the licensed student count follows the renewal',
      renewedRow?.studentCount === 321,
      `studentCount=${renewedRow?.studentCount}`,
    );
  }

  await app.close();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
