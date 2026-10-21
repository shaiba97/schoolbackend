import { Global, Module } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [TenantGuard],
  exports: [TenantGuard],
})
export class TenantModule {}
