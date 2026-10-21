import { HttpException, HttpStatus } from '@nestjs/common';

export type TenantLockReason = 'LICENSE_EXPIRED' | 'MANUAL_TERMINATION' | 'PROVIDER_SUSPENSION';

export interface TenantLockedBody {
  statusCode: number;
  code: 'TENANT_LOCKED';
  message: string;
  schoolName: string;
  lockedAt: string | null;
  reason: string | null;
  expiresAt: string | null;
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return 'an unknown date';
  return value.toISOString().slice(0, 10);
}

/**
 * The 403 a locked school receives.
 *
 * The body is deliberately flat: NestJS wraps an object payload under
 * `message`, which would turn the message into an object and break every
 * portal's `String(body.message)` extraction. A flat body also carries the
 * facts a portal needs to show the school why it is locked, in one shape
 * every portal can read without special-casing.
 */
export class TenantLockedException extends HttpException {
  constructor(input: {
    schoolName: string;
    lockedAt?: Date | null;
    reason?: string | null;
    expiresAt?: Date | null;
  }) {
    const reason = input.reason ?? null;
    const what =
      reason === 'MANUAL_TERMINATION'
        ? 'was terminated by the provider'
        : reason === 'PROVIDER_SUSPENSION'
          ? 'was suspended by the provider'
          : 'expired';

    const body: TenantLockedBody = {
      statusCode: HttpStatus.FORBIDDEN,
      code: 'TENANT_LOCKED',
      message: `Access Suspended: The license for ${input.schoolName} ${what} on ${formatDate(
        input.lockedAt,
      )}. Please contact platform administration to renew access.`,
      schoolName: input.schoolName,
      lockedAt: input.lockedAt ? input.lockedAt.toISOString() : null,
      reason,
      expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    };

    super(body, HttpStatus.FORBIDDEN);
  }
}

/** The lock facts a tenant carries, as the guard and the portal see them. */
export function tenantLockFacts(tenant: {
  name: string;
  status: string;
  lockedAt?: Date | null;
  lockReason?: string | null;
}) {
  return {
    schoolName: tenant.name,
    lockedAt: tenant.lockedAt ?? null,
    reason: tenant.lockReason ?? null,
  };
}
