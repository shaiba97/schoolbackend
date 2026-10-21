// Canonical phone handling, owned by the backend so that sign-in does not
// depend on which client formatted the number. Mirrors the academic frontend's
// `lib/validation/phone.ts`; the two must stay in step.
//
// Sudanese mobile numbers are 9 digits after the +249 country code, written as
// +2499XXXXXXXX, 09XXXXXXXX or 9XXXXXXXX. Everything is stored in E.164
// (+2499XXXXXXXX) so one person cannot hold two accounts that differ only by
// formatting.

const SUDANESE_MOBILE = /^(?:\+249|0)?9\d{8}$/;

export function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, '');
}

/** Storage form: +2499XXXXXXXX, or the input unchanged when it is not Sudanese. */
export function toE164Phone(raw: string): string {
  const value = normalizePhone(raw);
  if (value.startsWith('+249')) return value;
  if (value.startsWith('0')) return `+249${value.slice(1)}`;
  if (/^9\d{8}$/.test(value)) return `+249${value}`;
  return value;
}

export function isSudanesePhone(raw: string): boolean {
  return SUDANESE_MOBILE.test(normalizePhone(raw));
}

/**
 * Login lookup key. Accepts any of the accepted formats so a user can type
 * `0912345678`, `9…` or `+249 91 234 5678` and still match the stored value.
 */
export function phoneLookupKey(raw: string): string {
  return toE164Phone(raw);
}
