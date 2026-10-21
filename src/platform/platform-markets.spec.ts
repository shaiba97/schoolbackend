import { MARKETS, marketByCode, marketDefaults } from './platform-markets';

describe('MARKETS', () => {
  it('covers the markets the platform sells into', () => {
    expect(MARKETS.map((market) => market.code)).toEqual([
      'SD',
      'BH',
      'EG',
      'IQ',
      'KW',
      'OM',
      'QA',
      'SA',
      'AE',
    ]);
  });

  it('gives every market a currency, a timezone, and a name in both languages', () => {
    for (const market of MARKETS) {
      expect(market.currency).toMatch(/^[A-Z]{3}$/);
      expect(market.timezone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/);
      expect(market.name.length).toBeGreaterThan(0);
      expect(market.nameAr.length).toBeGreaterThan(0);
      expect(market.dialCode).toMatch(/^\+\d{1,4}$/);
    }
  });

  it('never repeats a country code', () => {
    const codes = MARKETS.map((market) => market.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('bills each market in its own currency', () => {
    expect(marketByCode('SA')?.currency).toBe('SAR');
    expect(marketByCode('AE')?.currency).toBe('AED');
    expect(marketByCode('KW')?.currency).toBe('KWD');
    expect(marketByCode('SD')?.currency).toBe('SDG');
  });

  it('derives the currency and timezone from the country', () => {
    expect(marketDefaults('SA')).toEqual({
      currency: 'SAR',
      timezone: 'Asia/Riyadh',
    });
    expect(marketDefaults('sd')).toEqual({
      currency: 'SDG',
      timezone: 'Africa/Khartoum',
    });
  });

  it('falls back to a safe default for an unknown country', () => {
    expect(marketDefaults('ZZ')).toEqual({ currency: 'USD', timezone: 'UTC' });
  });
});
