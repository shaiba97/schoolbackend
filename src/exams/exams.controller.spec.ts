import { ROLES_KEY } from '../auth/roles.decorator';
import { ExamsController } from './exams.controller';

/**
 * Authorization-lock regression test for the results release gate.
 *
 * Publishing must stay reachable by staff admins (ADMIN and ACADEMIC_ADMIN):
 * restricting it to ADMIN alone leaves no real human able to release
 * results. Asserts the handler-level role metadata, following the pattern in
 * students.controller.spec.ts — unit-test cost, fails loudly if someone
 * narrows the decorator again.
 */
function handlerRoles(
  handler: (...args: never[]) => unknown,
): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined;
}

describe('ExamsController publish authorization lock', () => {
  it('allows ADMIN and ACADEMIC_ADMIN to publish results', () => {
    // Metadata reflection only: the handler is never invoked unbound.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(handlerRoles(ExamsController.prototype.publish)).toEqual([
      'ADMIN',
      'ACADEMIC_ADMIN',
    ]);
  });

  it('restricts the moderation queue to ADMIN and ACADEMIC_ADMIN', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(handlerRoles(ExamsController.prototype.moderationQueue)).toEqual([
      'ADMIN',
      'ACADEMIC_ADMIN',
    ]);
  });
});
