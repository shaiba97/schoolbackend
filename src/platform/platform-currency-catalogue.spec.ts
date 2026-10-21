import {
  BASE_CURRENCY,
  CURRENCY_CATALOGUE,
  currencyByCode,
} from './platform-currency-catalogue';

describe('CURRENCY_CATALOGUE', () => {
  it('covers the base currency and every supported market', () => {
    expect([...CURRENCY_CATALOGUE.map((currency) => currency.code)].sort()).toEqual([
      'AED',
      'BHD',
      'EGP',
      'EUR',
      'IQD',
      'KWD',
      'OMR',
      'QAR',
      'SAR',
      'SDG',
      'USD',
    ]);
  });

  it('prices the base currency at one', () => {
    expect(currencyByCode(BASE_CURRENCY)?.defaultRateToUsd).toBe(1);
  });

  it('gives every currency a positive rate and a name', () => {
    for (const currency of CURRENCY_CATALOGUE) {
      expect(currency.defaultRateToUsd).toBeGreaterThan(0);
      expect(currency.name.length).toBeGreaterThan(0);
    }
  });

  it('gives every market currency a country', () => {
    // The base currency and the euro span more than one market, so they
    // carry no country of their own.
    const multiCountry = [BASE_CURRENCY, 'EUR'];
    for (const currency of CURRENCY_CATALOGUE) {
      if (multiCountry.includes(currency.code)) continue;
      expect(currency.countryCode).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('never repeats a currency code', () => {
    const codes = CURRENCY_CATALOGUE.map((currency) => currency.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('matches the spec examples for the GCC currencies', () => {
    expect(currencyByCode('SAR')?.defaultRateToUsd).toBe(3.75);
    expect(currencyByCode('AED')?.defaultRateToUsd).toBeCloseTo(3.6725, 4);
    expect(currencyByCode('KWD')?.defaultRateToUsd).toBeCloseTo(0.307, 3);
  });
});
