import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const adapter = new PrismaNeon({
      connectionString: process.env.DATABASE_URL!,
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * The callback is typed rather than `any` on purpose: it makes Prisma
   * validate every query at compile time. A wrong field or relation name used
   * to reach the database and fail at runtime ("Unknown argument"), which
   * mocked unit tests cannot see. Cast inside a query only when a genuinely
   * dynamic shape demands it.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { timeout?: number } = {},
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT set_config(
          'app.current_tenant_id',
          ${tenantId},
          true
        )
      `;
      return fn(tx);
    }, { maxWait: 10_000, ...(options.timeout ? { timeout: options.timeout } : {}) });
  }

  /**
   * Read-only tenant access WITHOUT an interactive transaction.
   *
   * Tenant isolation does NOT depend on the `app.current_tenant_id` GUC
   * (nothing in the schema, migrations, or codebase reads it — there is no
   * DB-level RLS). Isolation is enforced by the explicit
   * `where: { tenantId }` filters every query carries, which are unchanged —
   * that is why `_tenantId` is accepted for signature symmetry but needs no
   * session state.
   *
   * Use this for all pure reads (findAll/findOne/counts/reference data).
   * Every avoided `$transaction` frees a pooled connection, which is what
   * starves the pool (P2028) under burst load. Write paths MUST keep using
   * `withTenant` so multi-statement mutations stay atomic.
   */
  async withTenantRead<T>(
    _tenantId: string,
    fn: (db: PrismaService) => Promise<T>,
  ): Promise<T> {
    return fn(this);
  }
}
