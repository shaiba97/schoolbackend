// Academic portal session smoke test against the real database.
//
//   npx ts-node scripts/smoke-academic-portal.ts
//
// Provisions a school, creates an Academic Affairs staff member, signs that
// person in the way the portal does (staff number + password), and walks the
// endpoints the portal's profile and dashboard read: own profile, own details
// update, academic years, classes, subjects, students. Everything it creates
// is removed again.
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
import { StaffController } from '../src/staff/staff.controller';
import { StaffService } from '../src/staff/staff.service';
import { StaffModule } from '../src/staff/staff.module';
import { AcademicYearsController } from '../src/academic-years/academic-years.controller';
import { AcademicYearsService } from '../src/academic-years/academic-years.service';
import { ClassesController } from '../src/classes/classes.controller';
import { ClassesService } from '../src/classes/classes.service';
import { SubjectsController } from '../src/subjects/subjects.controller';
import { SubjectsService } from '../src/subjects/subjects.service';
import { StudentsController } from '../src/students/students.controller';
import { StudentsService } from '../src/students/students.service';
import { StorageModule } from '../src/storage/storage.module';

const EMAIL = (process.env.PLATFORM_ADMIN_EMAIL || 'root@platform.dev').toLowerCase();
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD || 'Platform@12345';

const STAMP = Date.now().toString().slice(-6);
const ADMIN_EMAIL = `principal-${STAMP}@smoke.school`;
const ADMIN_PASSWORD = 'Smoke@12345';
const STAFF_PASSWORD = 'Smoke@12345';

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
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      PrismaModule,
      AuthModule,
      StaffModule,
      StorageModule,
    ],
    controllers: [
      AuthController,
      PlatformAuthController,
      PlatformTenantsController,
      PlatformPlansController,
      StaffController,
      AcademicYearsController,
      ClassesController,
      SubjectsController,
      StudentsController,
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
      StaffService,
      AcademicYearsService,
      ClassesService,
      SubjectsService,
      StudentsService,
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

  console.log('\nacademic portal session smoke test');

  const platformLogin = await request(server)
    .post('/api/platform/auth/login')
    .send({ email: EMAIL, password: PASSWORD });
  const platformToken = platformLogin.body?.accessToken as string;
  check('platform login succeeds', platformLogin.status === 201 && Boolean(platformToken));

  const provisioned = await request(server)
    .post('/api/platform/tenants')
    .set('Authorization', `Bearer ${platformToken}`)
    .send({
      name: `Academic Portal Smoke ${STAMP}`,
      countryCode: 'SD',
      adminName: 'Smoke Principal',
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASSWORD,
      planCode: 'PRIMARY',
      studentCount: 120,
    });
  check(
    'a school is provisioned for the check',
    provisioned.status === 201 && Boolean(provisioned.body?.tenant?.id),
    `status=${provisioned.status} body=${JSON.stringify(provisioned.body).slice(0, 200)}`,
  );
  const tenantId = provisioned.body?.tenant?.id as string;

  const schoolLogin = await request(server)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const schoolToken = schoolLogin.body?.accessToken as string;
  check(
    'the school administrator can sign in',
    schoolLogin.status === 201 && Boolean(schoolToken),
    `status=${schoolLogin.status}`,
  );

  let staffNumber: string | undefined;
  if (schoolToken && tenantId) {
    const auth = { Authorization: `Bearer ${schoolToken}`, 'X-Tenant-Id': tenantId };

    const created = await request(server)
      .post('/api/staff')
      .set(auth)
      .send({
        fullName: 'Smoke Academician',
        phone: '+249900000321',
        position: 'ACADEMIC_AFFAIRS',
        password: STAFF_PASSWORD,
      });
    check(
      'an academic affairs staff member is created',
      created.status === 201 && Boolean(created.body?.staffNumber),
      `status=${created.status} body=${JSON.stringify(created.body).slice(0, 200)}`,
    );
    staffNumber = created.body?.staffNumber as string | undefined;

    const staffLogin = await request(server)
      .post('/api/auth/login')
      .send({ staffNumber, password: STAFF_PASSWORD, tenantId });
    check(
      'the academic affairs member signs in with the staff number',
      staffLogin.status === 201 && Boolean(staffLogin.body?.accessToken),
      `status=${staffLogin.status} body=${JSON.stringify(staffLogin.body).slice(0, 200)}`,
    );
    const academicToken = staffLogin.body?.accessToken as string;
    const memberships = (staffLogin.body?.memberships ?? []) as Array<{
      tenantId: string;
      roles: Array<{ slug: string }>;
    }>;
    check(
      'the membership carries the academic affairs role',
      memberships.some(
        (membership) =>
          membership.tenantId === tenantId &&
          membership.roles.some((role) => role.slug === 'ACADEMIC_ADMIN'),
      ),
      JSON.stringify(memberships.map((m) => m.roles.map((r) => r.slug))),
    );

    if (academicToken) {
      const academicAuth = {
        Authorization: `Bearer ${academicToken}`,
        'X-Tenant-Id': tenantId,
      };

      const profile = await request(server).get('/api/staff/me/profile').set(academicAuth);
      check(
        'the portal reads the staff member\'s own profile',
        profile.status === 200 &&
          profile.body?.tenant?.id === tenantId &&
          profile.body?.staffNumber === staffNumber,
        `status=${profile.status} body=${JSON.stringify(profile.body).slice(0, 200)}`,
      );
      check(
        'the profile names the academic affairs position',
        profile.body?.positionTitle === 'Academic Affairs',
        `positionTitle=${profile.body?.positionTitle}`,
      );
      check(
        'the profile lists the permissions the role carries',
        (profile.body?.roles ?? []).includes('ACADEMIC_ADMIN'),
        JSON.stringify(profile.body?.roles),
      );

      const updated = await request(server)
        .put('/api/auth/me')
        .set(academicAuth)
        .send({ firstName: 'Updated', phone: '+249900000654' });
      check(
        'the member updates their own details',
        updated.status === 200 && updated.body?.user?.firstName === 'Updated',
        `status=${updated.status} body=${JSON.stringify(updated.body).slice(0, 120)}`,
      );

      const afterUpdate = await request(server).get('/api/staff/me/profile').set(academicAuth);
      check(
        'the new phone is on the profile',
        afterUpdate.body?.phone === '+249900000654' &&
          afterUpdate.body?.firstName === 'Updated',
        `phone=${afterUpdate.body?.phone} firstName=${afterUpdate.body?.firstName}`,
      );

      const years = await request(server).get('/api/academic-years').set(academicAuth);
      check(
        'the academic years list answers for the member',
        years.status === 200 && Array.isArray(years.body?.data),
        `status=${years.status} body=${JSON.stringify(years.body).slice(0, 120)}`,
      );

      const classes = await request(server).get('/api/classes?limit=1').set(academicAuth);
      check(
        'the classes list answers for the member',
        classes.status === 200 && typeof classes.body?.total === 'number',
        `status=${classes.status}`,
      );

      const subjects = await request(server).get('/api/subjects?limit=1').set(academicAuth);
      check(
        'the subjects list answers for the member',
        subjects.status === 200 && typeof subjects.body?.total === 'number',
        `status=${subjects.status}`,
      );

      const students = await request(server).get('/api/students?limit=1').set(academicAuth);
      check(
        'the students list answers for the member',
        students.status === 200 && typeof students.body?.total === 'number',
        `status=${students.status}`,
      );
    }
  }

  if (tenantId) {
    await prisma.platformAuditLog.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
    if (staffNumber) {
      await prisma.user.deleteMany({ where: { staffNumber } });
    }
  }

  await app.close();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
