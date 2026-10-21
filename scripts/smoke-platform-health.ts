// Platform health smoke test against the real database.
//
//   npx ts-node scripts/smoke-platform-health.ts
//
// Checks that the health report answers with live numbers, that the
// public liveness probe works without a token, and that the report is
// refused for an unauthenticated caller.
import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaModule } from '../src/prisma/prisma.module';
import { RealtimeModule } from '../src/realtime/realtime.module';
import { AuthModule } from '../src/auth/auth.module';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { PlatformAuthController } from '../src/platform/platform-auth.controller';
import { PlatformAdminGuard } from '../src/platform/platform-admin.guard';
import { PlatformHealthController } from '../src/platform/platform-health.controller';
import { PlatformAuthService } from '../src/platform/platform-auth.service';
import { PlatformHealthService } from '../src/platform/platform-health.service';

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
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      PrismaModule,
      AuthModule,
      RealtimeModule,
    ],
    controllers: [
      AppController,
      AuthController,
      PlatformAuthController,
      PlatformHealthController,
    ],
    providers: [
      AppService,
      AuthService,
      PlatformAuthService,
      PlatformHealthService,
      PlatformAdminGuard,
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

  console.log('\nplatform health smoke test');

  const live = await request(server).get('/api/health');
  check(
    'the liveness probe answers without a token',
    live.status === 200 && live.body?.status === 'ok',
    `status=${live.status} body=${JSON.stringify(live.body)}`,
  );

  const login = await request(server)
    .post('/api/platform/auth/login')
    .send({ email: EMAIL, password: PASSWORD });
  const token = login.body?.accessToken as string;
  check('platform login succeeds', login.status === 201 && Boolean(token));

  if (token) {
    const report = await request(server)
      .get('/api/platform/health')
      .set('Authorization', `Bearer ${token}`);
    check('the health report answers', report.status === 200, `status=${report.status}`);
    check(
      'the database is reported as reachable with a latency',
      report.body?.database?.reachable === true &&
        typeof report.body?.database?.latencyMs === 'number',
      JSON.stringify(report.body?.database),
    );
    check(
      'the report carries live counts',
      typeof report.body?.counts?.tenants === 'number' &&
        report.body.counts.tenants > 0,
      JSON.stringify(report.body?.counts),
    );
    check(
      'the report carries runtime and storage figures',
      typeof report.body?.uptimeSeconds === 'number' &&
        typeof report.body?.storage?.bytes === 'number' &&
        typeof report.body?.realtime?.connections === 'number',
      JSON.stringify({
        uptime: report.body?.uptimeSeconds,
        storage: report.body?.storage?.bytes,
        sockets: report.body?.realtime?.connections,
      }),
    );
  }

  const anonymous = await request(server).get('/api/platform/health');
  check(
    'the health report refuses an unauthenticated caller',
    anonymous.status === 401,
    `status=${anonymous.status}`,
  );

  await app.close();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
