import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opt a route out of the globally-registered `JwtAuthGuard`.
 *
 * Authentication is deny-by-default: every route requires a valid bearer token
 * unless it is explicitly marked with `@Public()`. This exists because a
 * controller that forgets `@UseGuards` used to ship fully open — see
 * `StudentsController`, whose 24 staff routes were reachable with no token.
 * Requiring an explicit opt-out means the safe case is the default.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);