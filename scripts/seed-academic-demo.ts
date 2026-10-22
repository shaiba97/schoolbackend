// Seeds a demo school with an Academic Affairs member so the academic
// portal can be clicked through by hand.
//
//   npx ts-node scripts/seed-academic-demo.ts
//
// Prints the credentials it created. The school it provisions is kept (it is
// the point of the seed); delete it from the console when it has served its
// purpose.
import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../src/prisma/prisma.module';
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

const EMAIL = (process.env.PLATFORM_ADMIN_EMAIL || 'root@platform.dev').toLowerCase();
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD || 'Platform@12345';

const STAMP = Date.now().toString().slice(-6);
const ADMIN_EMAIL = `principal-${STAMP}@demo.school`;
const ADMIN_PASSWORD = 'Demo@12345';
const STAFF_PASSWORD = 'Demo@12345';

async function main() {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, StaffModule],
    controllers: [
      AuthController,
      PlatformAuthController,
      PlatformTenantsController,
      PlatformPlansController,
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

  const platformLogin = await request(server)
    .post('/api/platform/auth/login')
    .send({ email: EMAIL, password: PASSWORD });
  const platformToken = platformLogin.body?.accessToken as string;
  if (!platformToken) throw new Error('platform login failed');

  const provisioned = await request(server)
    .post('/api/platform/tenants')
    .set('Authorization', `Bearer ${platformToken}`)
    .send({
      name: `Academic Demo School ${STAMP}`,
      countryCode: 'SD',
      adminName: 'Demo Principal',
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASSWORD,
      planCode: 'PRIMARY',
      studentCount: 180,
    });
  if (provisioned.status !== 201) {
    throw new Error(`provisioning failed: ${JSON.stringify(provisioned.body)}`);
  }
  const tenantId = provisioned.body?.tenant?.id as string;

  const schoolLogin = await request(server)
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const schoolToken = schoolLogin.body?.accessToken as string;

  const created = await request(server)
    .post('/api/staff')
    .set('Authorization', `Bearer ${schoolToken}`)
    .set('X-Tenant-Id', tenantId)
    .send({
      fullName: 'Demo Academician',
      phone: '+249900000111',
      position: 'ACADEMIC_AFFAIRS',
      password: STAFF_PASSWORD,
    });
  if (created.status !== 201) {
    throw new Error(`staff creation failed: ${JSON.stringify(created.body)}`);
  }

  console.log('\nAcademic portal demo account');
  console.log(`  school      ${provisioned.body?.tenant?.name} (${tenantId})`);
  console.log(`  staff id    ${created.body?.staffNumber}`);
  console.log(`  password    ${STAFF_PASSWORD}`);
  console.log(`  portal      http://localhost:5000/login\n`);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
