import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentTenant = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const tenant = request.tenant;
    if (tenant) return data ? tenant?.[data] : tenant;
    const tenantId = request.headers?.['x-tenant-id'];
    if (typeof tenantId !== 'string') return undefined;
    return data === 'tenantId' ? tenantId : { tenantId };
  },
);
