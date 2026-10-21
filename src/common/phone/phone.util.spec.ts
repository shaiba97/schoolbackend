import {
  isSudanesePhone,
  normalizePhone,
  phoneLookupKey,
  toE164Phone,
} from './phone.util';

describe('normalizePhone', () => {
  it('strips spacing, dashes and parentheses', () => {
    expect(normalizePhone('+249 91 234 5678')).toBe('+249912345678');
    expect(normalizePhone('(091) 234-5678')).toBe('0912345678');
  });
});

describe('toE164Phone', () => {
  it('converts every accepted Sudanese format to E.164', () => {
    expect(toE164Phone('+249912345678')).toBe('+249912345678');
    expect(toE164Phone('0912345678')).toBe('+249912345678');
    expect(toE164Phone('912345678')).toBe('+249912345678');
    expect(toE164Phone('+249 91 234 5678')).toBe('+249912345678');
  });

  it('leaves a number it cannot interpret untouched rather than corrupting it', () => {
    expect(toE164Phone('+1234567890')).toBe('+1234567890');
  });

  it('is idempotent, so re-saving a record cannot change it', () => {
    const once = toE164Phone('0912345678');
    expect(toE164Phone(once)).toBe(once);
  });
});

describe('isSudanesePhone', () => {
  it('accepts the three Sudanese mobile formats', () => {
    expect(isSudanesePhone('+249912345678')).toBe(true);
    expect(isSudanesePhone('0912345678')).toBe(true);
    expect(isSudanesePhone('912345678')).toBe(true);
  });

  it('rejects wrong lengths and other countries', () => {
    expect(isSudanesePhone('+24991234567')).toBe(false);
    expect(isSudanesePhone('+1234567890')).toBe(false);
    expect(isSudanesePhone('')).toBe(false);
  });
});

describe('phoneLookupKey', () => {
  it('maps every format of the same number to one key', () => {
    const key = phoneLookupKey('0912345678');
    expect(phoneLookupKey('+249912345678')).toBe(key);
    expect(phoneLookupKey('912345678')).toBe(key);
    expect(phoneLookupKey('+249 91 234 5678')).toBe(key);
  });
});
