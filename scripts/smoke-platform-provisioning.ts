// Platform provisioning smoke test against the real database.
//
//   npx ts-node scripts/smoke-platform-provisioning.ts
//
// Provisions a throwaway school, proves the administrator can sign in to the
// school portal with the generated credentials, and then removes everything
// the test created.
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
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PlatformAuthController } from '../src/platform/platform-auth.controller';
import { PlatformAdminGuard } from '../src/platform/platform-admin.guard';
import { PlatformRoleGuard } from '../src/platform/platform-role.guard';
import { PlatformTenantsController } from '../src/platform/platform-tenants.controller';
import { PlatformAuthService } from '../src/platform/platform-auth.service';
import { PlatformProvisioningService } from '../src/platform/platform-provisioning.service';
import { PlatformTenantsService } from '../src/platform/platform-tenants.service';

const EMAIL = (process.env.PLATFORM_ADMIN_EMAIL || 'root@platform.dev').toLowerCase();
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD || 'Platform@12345';

const STAMP = Date.now().toString().slice(-6);
const SLUG = `smoke-school-${STAMP}`;
const ADMIN_EMAIL = `admin-${STAMP}@smoke.school`;
const ADMIN_PASSWORD = 'Smoke@12345';

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
    controllers: [AuthController, PlatformAuthController, PlatformTenantsController],
    providers: [
      AuthService,
      PlatformAuthService,
      PlatformTenantsService,
      PlatformProvisioningService,
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

  console.log('\nplatform provisioning smoke test');

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

  const plans = await request(server).get('/api/platform/plans').set('Authorization', auth);
  check('plans are listed', plans.status === 200 && Array.isArray(plans.body), `status=${plans.status}`);
  const planCode = plans.body?.[0]?.code as string | undefined;

  const created = await request(server)
    .post('/api/platform/tenants')
    .set('Authorization', auth)
    .send({
      name: `Smoke School ${STAMP}`,
      slug: SLUG,
      email: `office-${STAMP}@smoke.school`,
      countryCode: 'SD',
      currencyCode: 'SDG',
      timezone: 'Africa/Khartoum',
      adminName: 'Smoke Admin',
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASSWORD,
      planCode,
      modules: ['ADMIN', 'ACADEMIC'],
      featureFlags: { 'notifications.whatsapp': true },
    });
  check(
    'school is provisioned',
    created.status === 201 && created.body?.tenant?.slug === SLUG,
    `status=${created.status} body=${JSON.stringify(created.body)}`,
  );
  const tenantId = created.body?.tenant?.id as string;

  const duplicate = await request(server)
    .post('/api/platform/tenants')
    .set('Authorization', auth)
    .send({
      name: `Smoke School ${STAMP}`,
      slug: SLUG,
      adminName: 'Smoke Admin',
      adminEmail: `other-${STAMP}@smoke.school`,
      adminPassword: ADMIN_PASSWORD,
    });
  check('duplicate slug is refused', duplicate.status === 409, `status=${duplicate.status}`);

  const weakPassword = await request(server)
    .post('/api/platform/tenants')
    .set('Authorization', auth)
    .send({
      name: `Smoke School ${STAMP}`,
      slug: `smoke-weak-${STAMP}`,
      adminName: 'Smoke Admin',
      adminEmail: `weak-${STAMP}@smoke.school`,
      adminPassword: 'short',
    });
  check('weak password is refused', weakPassword.status === 400, `status=${weakPassword.status}`);

  const detail = await request(server)
    .get(`/api/platform/tenants/${tenantId}`)
    .set('Authorization', auth);
  check(
    'provisioned school carries its modules, flags, and license',
    detail.status === 200 &&
      (detail.body?.modules ?? []).filter((row: { enabled: boolean }) => row.enabled).length === 2 &&
      (detail.body?.featureFlags ?? []).some(
        (row: { key: string; enabled: boolean }) =>
          row.key === 'notifications.whatsapp' && row.enabled,
      ) &&
      (detail.body?.licenses ?? []).length === 1,
    JSON.stringify({
      modules: detail.body?.modules,
      flags: detail.body?.featureFlags,
      licenses: detail.body?.licenses?.length,
    }),
  );

  const schoolLogin = await request(server)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check(
    'the provisioned administrator can sign in to the school portal',
    schoolLogin.status === 201 && Boolean(schoolLogin.body?.accessToken),
    `status=${schoolLogin.status} body=${JSON.stringify(schoolLogin.body).slice(0, 200)}`,
  );
  check(
    'the school login is scoped to the new tenant',
    (schoolLogin.body?.memberships ?? []).some(
      (membership: { tenantId: string }) => membership.tenantId === tenantId,
    ),
    JSON.stringify(schoolLogin.body?.memberships),
  );

  if (tenantId) {
    await prisma.platformAuditLog.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  }

  const gone = await request(server)
    .get(`/api/platform/tenants/${tenantId}`)
    .set('Authorization', auth);
  check('the smoke school is cleaned up', gone.status === 404, `status=${gone.status}`);

  await app.close();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
