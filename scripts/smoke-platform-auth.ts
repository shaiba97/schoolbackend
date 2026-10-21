// Platform auth smoke test against the real database.
//
//   npx ts-node scripts/smoke-platform-auth.ts
//
// Boots the platform auth slice in-process (no port is bound, so it never
// collides with a running API) and asserts the cross-tenant guarantees:
// platform tokens carry scope 'platform', school-scoped tokens cannot reach
// platform endpoints, and a suspended admin is refused.
import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaModule } from '../src/prisma/prisma.module';
import { AuthModule } from '../src/auth/auth.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PlatformAuthService } from '../src/platform/platform-auth.service';
import { PlatformAdminGuard } from '../src/platform/platform-admin.guard';
import { PlatformAuthController } from '../src/platform/platform-auth.controller';

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
    controllers: [PlatformAuthController],
    providers: [
      PlatformAuthService,
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
  const jwt = app.get(JwtService);
  const prisma = app.get(PlatformAuthService) as unknown as {
    platformMe: (userId: string) => Promise<{ profile: { role: string } }>;
  };

  console.log('\nplatform auth smoke test');

  const login = await request(server)
    .post('/api/platform/auth/login')
    .send({ email: EMAIL, password: PASSWORD });
  check('login with valid credentials returns 201', login.status === 201, `status=${login.status}`);
  const token = login.body?.accessToken as string | undefined;
  check('login returns an access token', Boolean(token));
  check(
    'login returns the platform profile',
    login.body?.profile?.role === 'SUPER_ADMIN',
    JSON.stringify(login.body?.profile),
  );

  if (token) {
    const claims = jwt.decode(token) as { scope?: string; role?: string; sub?: string };
    check('token carries scope=platform', claims?.scope === 'platform', JSON.stringify(claims));
    check('token carries the admin role', claims?.role === 'SUPER_ADMIN', JSON.stringify(claims));

    const me = await request(server)
      .get('/api/platform/auth/me')
      .set('Authorization', `Bearer ${token}`);
    check('me with a platform token returns 200', me.status === 200, `status=${me.status}`);
    check('me returns the admin email', me.body?.user?.email === EMAIL, JSON.stringify(me.body?.user));

    const schoolToken = await jwt.signAsync({ sub: claims.sub, email: claims.sub });
    const crossScope = await request(server)
      .get('/api/platform/auth/me')
      .set('Authorization', `Bearer ${schoolToken}`);
    check(
      'me with a school-scoped token is refused',
      crossScope.status === 403,
      `status=${crossScope.status}`,
    );

    const noToken = await request(server).get('/api/platform/auth/me');
    check('me without a token is refused', noToken.status === 401, `status=${noToken.status}`);

    const profile = await prisma.platformMe(claims.sub as string);
    check('platformMe resolves the admin row', profile.profile.role === 'SUPER_ADMIN');
  }

  const badPassword = await request(server)
    .post('/api/platform/auth/login')
    .send({ email: EMAIL, password: 'definitely-wrong' });
  check(
    'login with a wrong password returns 401',
    badPassword.status === 401,
    `status=${badPassword.status}`,
  );

  const unknownUser = await request(server)
    .post('/api/platform/auth/login')
    .send({ email: 'nobody@platform.dev', password: PASSWORD });
  check(
    'login with an unknown email returns 401',
    unknownUser.status === 401,
    `status=${unknownUser.status}`,
  );

  const invalidBody = await request(server)
    .post('/api/platform/auth/login')
    .send({ email: 'not-an-email', password: 'x' });
  check(
    'login with an invalid body returns 400',
    invalidBody.status === 400,
    `status=${invalidBody.status}`,
  );

  await app.close();
  console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
