import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/roles.decorator';
import { StudentsController } from './students.controller';
import { FeesController } from '../fees/fees.controller';
import { AttendanceController } from '../attendance/attendance.controller';

/**
 * Authorization-lock regression tests.
 *
 * These assert the *class-level* guard metadata, not request behaviour. That
 * is deliberate: `StudentsController` previously guarded only a single handler,
 * which left the other 24 routes reachable with no token at all (TenantGuard
 * never ran, so `@CurrentTenant` fell back to the raw X-Tenant-Id header). A
 * behavioural test needs a booted Nest app with a JWT strategy; a metadata
 * assertion catches the same regression at unit-test cost, and fails loudly if
 * someone removes the class decorator.
 *
 * Guards are matched by class name rather than identity: importing JwtAuthGuard
 * directly drags in @nestjs/passport, which ships ESM, and this repo's ts-jest
 * transform targets CommonJS.
 */
function classGuardNames(controller: Function): string[] {
  const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
  return guards.map((guard: Function) => guard.name);
}

function classRoles(controller: Function): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, controller);
}

describe('StudentsController authorization lock', () => {
  it('applies JwtAuthGuard at class level so no route is tokenless', () => {
    expect(classGuardNames(StudentsController)).toContain('JwtAuthGuard');
  });

  it('applies TenantGuard at class level so tenant scoping is resolved server-side', () => {
    expect(classGuardNames(StudentsController)).toContain('TenantGuard');
  });

  it('applies RolesGuard at class level', () => {
    expect(classGuardNames(StudentsController)).toContain('RolesGuard');
  });

  it('restricts the whole controller to staff roles', () => {
    expect(classRoles(StudentsController)).toEqual(['ADMIN', 'ACADEMIC_ADMIN']);
  });
});

describe('FeesController authorization lock', () => {
  it('applies RolesGuard at class level', () => {
    expect(classGuardNames(FeesController)).toContain('RolesGuard');
  });

  it('restricts reads to staff roles', () => {
    expect(classRoles(FeesController)).toEqual(['ADMIN', 'ACADEMIC_ADMIN']);
  });
});

describe('AttendanceController authorization lock', () => {
  it('applies RolesGuard at class level', () => {
    expect(classGuardNames(AttendanceController)).toContain('RolesGuard');
  });

  it('allows staff and teachers', () => {
    expect(classRoles(AttendanceController)).toEqual(['ADMIN', 'ACADEMIC_ADMIN', 'TEACHER']);
  });
});