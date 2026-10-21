// Platform financials smoke test against the real database.
//
//   npx ts-node scripts/smoke-platform-financials.ts
//
// Walks the spec's verification steps against the live database: the P&L
// overview and country breakdown, a rate change moving every converted
// figure, and a recorded payment moving a subscription from OVERDUE to
// PAID. Everything it creates is removed again before it exits.
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
import { PlatformFinancialsController } from '../src/platform/platform-financials.controller';
import { PlatformTenantsController } from '../src/platform/platform-tenants.controller';
import { PlatformAuthService } from '../src/platform/platform-auth.service';
import { PlatformFinancialsService } from '../src/platform/platform-financials.service';
import { PlatformTenantsService } from '../src/platform/platform-tenants.service';
import { PlatformProvisioningService } from '../src/platform/platform-provisioning.service';
import {
  ManualPaymentGatewayAdapter,
  PaymentGatewayRegistry,
} from '../src/platform/payment-gateway.adapter';

const EMAIL = (
  process.env.PLATFORM_ADMIN_EMAIL || 'root@platform.dev'
).toLowerCase();
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
    ],
    controllers: [
      PlatformAuthController,
      PlatformFinancialsController,
      PlatformTenantsController,
    ],
    providers: [
      PlatformAuthService,
      PlatformFinancialsService,
      PlatformTenantsService,
      PlatformProvisioningService,
      ManualPaymentGatewayAdapter,
      PaymentGatewayRegistry,
      PlatformAdminGuard,
      PlatformRoleGuard,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api');
  await app.init();
  const server = app.getHttpServer();
  const prisma = app.get(PrismaService);

  console.log('\nplatform financials smoke test');

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

  // 1. Overview: totals and a country breakdown.
  const overview = await request(server)
    .get('/api/platform/financials/overview')
    .set('Authorization', auth);
  check(
    'overview returns 200',
    overview.status === 200,
    `status=${overview.status}`,
  );
  check(
    'overview reports revenue, expenses, and net profit in USD',
    typeof overview.body?.totals?.revenue === 'number' &&
      typeof overview.body?.totals?.expenses === 'number' &&
      typeof overview.body?.totals?.netProfit === 'number',
    JSON.stringify(overview.body?.totals),
  );
  check(
    'overview breaks the platform down per country',
    Array.isArray(overview.body?.countries) &&
      overview.body.countries.length >= 8,
    `countries=${overview.body?.countries?.length}`,
  );

  const currencies = await request(server)
    .get('/api/platform/financials/currencies')
    .set('Authorization', auth);
  check(
    'currencies are listed with rates',
    currencies.status === 200 &&
      currencies.body.some((row: { code: string }) => row.code === 'SAR') &&
      currencies.body.some((row: { code: string }) => row.code === 'USD'),
    `status=${currencies.status}`,
  );

  // 2. A priced school is provisioned first: the seeded schools all hold the
  // free LEGACY plan, so a subscription with a real local price only exists
  // once one is created here.
  const stamp = Date.now().toString().slice(-6);
  const slug = `fin-smoke-${stamp}`;
  const adminEmail = `fin-${stamp}@smoke.school`;
  const provisioned = await request(server)
    .post('/api/platform/tenants')
    .set('Authorization', auth)
    .send({
      name: `Financial Smoke School ${stamp}`,
      countryCode: 'SD',
      adminName: 'Fin Smoke Admin',
      adminEmail,
      adminPassword: 'Smoke@12345',
      planCode: 'PRIMARY',
      studentCount: 100,
    });
  check(
    'a priced school can be provisioned for the payment check',
    provisioned.status === 201 && Boolean(provisioned.body?.tenant?.id),
    `status=${provisioned.status} body=${JSON.stringify(provisioned.body)}`,
  );
  const targetId = provisioned.body?.tenant?.id as string;

  const after = await request(server)
    .get('/api/platform/financials/subscriptions')
    .set('Authorization', auth);
  const target = after.body?.find(
    (row: { tenantId: string }) => row.tenantId === targetId,
  );
  check(
    'the new school shows as an OVERDUE subscription',
    Boolean(target) && target.status === 'OVERDUE',
    JSON.stringify(target),
  );
  check(
    'the new school is priced in its own currency',
    Boolean(target) &&
      (target.localPrice ?? 0) > 0 &&
      target.currency === 'SDG',
    `localPrice=${target?.localPrice} currency=${target?.currency}`,
  );

  // 3. A rate change moves every converted figure.
  if (target) {
    const affectedCurrency = target.currency;
    const originalRate = target.rateToUsd ?? 1;
    const newRate = Math.round((originalRate + 1) * 10000) / 10000;

    const updated = await request(server)
      .patch(`/api/platform/financials/currencies/${affectedCurrency}`)
      .set('Authorization', auth)
      .send({ rateToUsd: newRate });
    check(
      'a rate can be changed',
      updated.status === 200,
      `status=${updated.status} body=${JSON.stringify(updated.body)}`,
    );

    const afterRateChange = await request(server)
      .get('/api/platform/financials/subscriptions')
      .set('Authorization', auth);
    const moved = afterRateChange.body?.find(
      (row: { tenantId: string }) => row.tenantId === target.tenantId,
    );
    check(
      'the new rate changes the converted subscription values',
      Boolean(moved) && moved.localPrice !== target.localPrice,
      `before=${target.localPrice} after=${moved?.localPrice} currency=${affectedCurrency}`,
    );

    await request(server)
      .patch(`/api/platform/financials/currencies/${affectedCurrency}`)
      .set('Authorization', auth)
      .send({ rateToUsd: originalRate });
  }

  // 4. A recorded payment moves a subscription from OVERDUE to PAID.
  if (target) {
    const payment = await request(server)
      .post('/api/platform/financials/payments')
      .set('Authorization', auth)
      .send({
        tenantId: target.tenantId,
        licenseId: target.licenseId,
        amount: target.localPrice,
        currency: target.currency,
        method: 'BANK_TRANSFER',
        paidAt: '2026-04-02T00:00:00.000Z',
        reference: 'SMOKE-REF-1',
      });
    check(
      'the payment is recorded',
      payment.status === 201 && Boolean(payment.body?.id),
      `status=${payment.status} body=${JSON.stringify(payment.body)}`,
    );

    const reloaded = await request(server)
      .get('/api/platform/financials/subscriptions')
      .set('Authorization', auth);
    const row = reloaded.body?.find(
      (entry: { tenantId: string }) => entry.tenantId === target.tenantId,
    );
    check(
      'the subscription status moves to PAID',
      row?.status === 'PAID',
      `status=${row?.status} paid=${row?.paidAmount}`,
    );
    check(
      'the payment type is shown on the subscription',
      row?.paymentType === 'MANUAL_TRANSFER',
      `type=${row?.paymentType}`,
    );

    const receipt = await request(server)
      .post('/api/platform/financials/receipts')
      .set('Authorization', auth)
      .send({
        tenantId: target.tenantId,
        licenseId: target.licenseId,
        amount: target.localPrice,
        currency: target.currency,
      });
    check(
      'a receipt can be issued for the payment',
      receipt.status === 201 && Boolean(receipt.body?.number),
      `status=${receipt.status} body=${JSON.stringify(receipt.body)}`,
    );

    const expense = await request(server)
      .post('/api/platform/financials/expenses')
      .set('Authorization', auth)
      .send({
        title: 'Smoke test hosting',
        category: 'INFRASTRUCTURE',
        amount: 120,
        currency: 'USD',
        paidAt: '2026-04-01T00:00:00.000Z',
      });
    check(
      'a platform expense can be logged',
      expense.status === 201 && Boolean(expense.body?.id),
      `status=${expense.status}`,
    );

    const overviewAfter = await request(server)
      .get('/api/platform/financials/overview')
      .set('Authorization', auth);
    check(
      'the expense lands in the P&L',
      overviewAfter.body?.totals?.expenses >= 120,
      `expenses=${overviewAfter.body?.totals?.expenses}`,
    );
    check(
      'the payment lands in the P&L revenue',
      overviewAfter.body?.totals?.revenue > 0,
      `revenue=${overviewAfter.body?.totals?.revenue}`,
    );

    // Clean up everything the smoke test created.
    if (expense.body?.id) {
      await prisma.platformExpense.delete({ where: { id: expense.body.id } });
    }
    if (receipt.body?.id) {
      await prisma.platformInvoice.delete({ where: { id: receipt.body.id } });
    }
    await prisma.platformPayment.deleteMany({
      where: { reference: 'SMOKE-REF-1' },
    });
    await prisma.platformAuditLog.deleteMany({
      where: { action: { startsWith: 'platform.' }, tenantId: target.tenantId },
    });
    if (targetId) {
      await prisma.platformAuditLog.deleteMany({
        where: { tenantId: targetId },
      });
      await prisma.tenant.delete({ where: { id: targetId } });
      await prisma.user.deleteMany({ where: { email: adminEmail } });
    }
  }

  const anonymous = await request(server).get(
    '/api/platform/financials/overview',
  );
  check(
    'the overview refuses an unauthenticated caller',
    anonymous.status === 401,
  );

  await app.close();
  console.log(
    failures === 0
      ? '\nall checks passed\n'
      : `\n${failures} check(s) failed\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
