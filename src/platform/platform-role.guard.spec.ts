import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PlatformRoleGuard, PLATFORM_ROLES_KEY } from './platform-role.guard';

function makeContext(request: Record<string, unknown>, requiredRoles?: string[]) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector;
  const guard = new PlatformRoleGuard(reflector);
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as unknown as ExecutionContext;
  return { guard, context, reflector };
}

describe('PlatformRoleGuard', () => {
  it('lets a super admin through a super-admin-only route', () => {
    const { guard, context } = makeContext(
      { platformAdmin: { role: 'SUPER_ADMIN' } },
      ['SUPER_ADMIN'],
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('refuses a support agent on a super-admin-only route', () => {
    const { guard, context } = makeContext(
      { platformAdmin: { role: 'SUPPORT' } },
      ['SUPER_ADMIN'],
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('refuses when no platform admin was resolved', () => {
    const { guard, context } = makeContext({}, ['SUPER_ADMIN']);

    expect(() => guard.canActivate(context)).toThrow(
      'This action requires super admin access',
    );
  });

  it('allows the route when no roles are required', () => {
    const { guard, context } = makeContext({ platformAdmin: { role: 'SUPPORT' } });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('reads the required roles from the platform roles metadata key', () => {
    expect(PLATFORM_ROLES_KEY).toBe('platformRoles');
  });
});
