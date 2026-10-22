// School admin workspace smoke test against the real database.
//
//   npx ts-node scripts/smoke-school-admin.ts
//
// Provisions a school on the Primary tier (which grants admin, academic,
// teacher, and student but not transport), signs in as that school's
// administrator, and walks the workspace: the overview, the profile and
// school edits, and the tier gate on positions. Everything it creates is
// removed again.
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
import { PlatformAuthService } from '../src/platform/platform-auth.service';
import { PlatformAdminGuard } from '../src/platform/platform-admin.guard';
import { PlatformRoleGuard } from '../src/platform/platform-role.guard';
import { PlatformPlansController } from '../src/platform/platform-plans.controller';
import { PlatformPlansService } from '../src/platform/platform-plans.service';
import { PlatformExpirationService } from '../src/platform/platform-expiration.service';
import { PlatformTenantsController } from '../src/platform/platform-tenants.controller';
import { PlatformTenantsService } from '../src/platform/platform-tenants.service';
import { PlatformProvisioningService } from '../src/platform/platform-provisioning.service';
import { SchoolAdminController } from '../src/school-admin/school-admin.controller';
import { SchoolAdminService } from '../src/school-admin/school-admin.service';
import { StaffController } from '../src/staff/staff.controller';
import { StaffService } from '../src/staff/staff.service';
import { StaffModule } from '../src/staff/staff.module';

const EMAIL = (process.env.PLATFORM_ADMIN_EMAIL || 'root@platform.dev').toLowerCase();
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD || 'Platform@12345';

const STAMP = Date.now().toString().slice(-6);
const SLUG = `school-admin-smoke-${STAMP}`;
const ADMIN_EMAIL = `owner-${STAMP}@smoke.school`;
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
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, StaffModule],
    controllers: [
      AuthController,
      PlatformAuthController,
      PlatformTenantsController,
      PlatformPlansController,
      SchoolAdminController,
      StaffController,
    ],
    providers: [
      AuthService,
      PlatformAuthService,
      PlatformTenantsService,
      PlatformProvisioningService,
      PlatformPlansService,
      PlatformExpirationService,
      PlatformAdminGuard,
      PlatformRoleGuard,
      SchoolAdminService,
      StaffService,
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

  console.log('\nschool admin workspace smoke test');

  const platformLogin = await request(server)
    .post('/api/platform/auth/login')
    .send({ email: EMAIL, password: PASSWORD });
  const platformToken = platformLogin.body?.accessToken as string;
  check('platform login succeeds', platformLogin.status === 201 && Boolean(platformToken));

  const provisioned = await request(server)
    .post('/api/platform/tenants')
    .set('Authorization', `Bearer ${platformToken}`)
    .send({
      name: `School Admin Smoke ${STAMP}`,
      countryCode: 'SD',
      adminName: 'Smoke Owner',
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASSWORD,
      planCode: 'PRIMARY',
      studentCount: 120,
    });
  check(
    'a school is provisioned for the check',
    provisioned.status === 201 && Boolean(provisioned.body?.tenant?.id),
    `status=${provisioned.status} body=${JSON.stringify(provisioned.body)}`,
  );
  const tenantId = provisioned.body?.tenant?.id as string;

  const schoolLogin = await request(server)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const schoolToken = schoolLogin.body?.accessToken as string;
  check(
    'the school administrator can sign in',
    schoolLogin.status === 201 && Boolean(schoolToken),
    `status=${schoolLogin.status} body=${JSON.stringify(schoolLogin.body).slice(0, 200)}`,
  );

  if (schoolToken && tenantId) {
    const auth = { Authorization: `Bearer ${schoolToken}`, 'X-Tenant-Id': tenantId };

    const overview = await request(server).get('/api/school-admin/overview').set(auth);
    check('the overview answers', overview.status === 200, `status=${overview.status}`);
    check(
      'the overview reports the admin, the school, and the plan',
      overview.body?.admin?.role === 'SCHOOL_ADMIN' &&
        overview.body?.tenant?.id === tenantId &&
        overview.body?.subscription?.tier === 'PRIMARY',
      JSON.stringify({
        admin: overview.body?.admin?.role,
        tenant: overview.body?.tenant?.id,
        tier: overview.body?.subscription?.tier,
      }),
    );
    check(
      'the plan the school pays for is reported with its term and countdown',
      typeof overview.body?.subscription?.daysRemaining === 'number' &&
        overview.body?.subscription?.durationDays === 365,
      JSON.stringify(overview.body?.subscription),
    );
    check(
      'a portal the tier does not grant is locked',
      overview.body?.portals?.find((row: { portal: string }) => row.portal === 'TRANSPORT')
        ?.unlocked === false,
      JSON.stringify(overview.body?.portals),
    );
    check(
      'the positions of a locked portal are not offered',
      !(overview.body?.allowedPositions ?? []).some(
        (row: { position: string }) => row.position === 'TRANSPORT_COORDINATOR',
      ),
      JSON.stringify(overview.body?.allowedPositions),
    );

    const profile = await request(server)
      .patch('/api/school-admin/profile')
      .set(auth)
      .send({ firstName: 'Smoke', phone: '+249900000123' });
    check(
      'the administrator can update their own details',
      profile.status === 200 && profile.body?.firstName === 'Smoke',
      `status=${profile.status} body=${JSON.stringify(profile.body)}`,
    );

    const tenantEdit = await request(server)
      .patch('/api/school-admin/tenant')
      .set(auth)
      .send({ name: `School Admin Smoke ${STAMP} Renamed` });
    check(
      'the administrator can update the school details',
      tenantEdit.status === 200 &&
        tenantEdit.body?.name === `School Admin Smoke ${STAMP} Renamed`,
      `status=${tenantEdit.status}`,
    );

    const lockedPosition = await request(server)
      .post('/api/school-admin/positions')
      .set(auth)
      .send({ title: 'Head of Transport', portal: 'TRANSPORT' });
    check(
      'a position for a portal the plan does not include is refused',
      lockedPosition.status === 403,
      `status=${lockedPosition.status} body=${JSON.stringify(lockedPosition.body)}`,
    );

    const allowedPosition = await request(server)
      .post('/api/school-admin/positions')
      .set(auth)
      .send({ title: 'Head of Academic', portal: 'ACADEMIC' });
    check(
      'a position for a portal the plan includes is created',
      allowedPosition.status === 201 && allowedPosition.body?.portal === 'ACADEMIC',
      `status=${allowedPosition.status} body=${JSON.stringify(allowedPosition.body)}`,
    );

    const positionId = allowedPosition.body?.id as string;
    const deleted = await request(server)
      .delete(`/api/school-admin/positions/${positionId}`)
      .set(auth);
    check(
      'an empty position can be deleted',
      deleted.status === 200 && deleted.body?.deleted === true,
      `status=${deleted.status} body=${JSON.stringify(deleted.body)}`,
    );

    const staffRefusal = await request(server)
      .post('/api/staff')
      .set(auth)
      .send({
        fullName: 'Transport Person',
        phone: '+249900000999',
        position: 'TRANSPORT_COORDINATOR',
        password: 'secret123',
      });
    check(
      'a staff account in a locked portal is refused by the server too',
      staffRefusal.status === 403,
      `status=${staffRefusal.status} body=${JSON.stringify(staffRefusal.body)}`,
    );

    const anonymous = await request(server).get('/api/school-admin/overview');
    check(
      'the overview refuses an unauthenticated caller',
      anonymous.status === 401,
      `status=${anonymous.status}`,
    );
  }

  if (tenantId) {
    await prisma.platformAuditLog.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  }

  await app.close();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
