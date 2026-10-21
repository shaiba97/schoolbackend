export type CurrencyDefinition = {
  /** ISO 4217 code. */
  code: string;
  name: string;
  countryCode: string | null;
  symbol: string | null;
  /**
   * Units of this currency per 1 USD. A starting value, not a promise: the
   * console may override it, and the seeded rate is only the default a
   * fresh environment starts from.
   */
  defaultRateToUsd: number;
  /** Whether this currency may be synced from a live rate provider. */
  autoSync: boolean;
};

/**
 * The platform's supported currencies. USD is the base: every rate in the
 * table is "how many units of this currency for 1 USD".
 */
export const CURRENCY_CATALOGUE: CurrencyDefinition[] = [
  {
    code: 'USD',
    name: 'US Dollar',
    countryCode: null,
    symbol: '$',
    defaultRateToUsd: 1,
    autoSync: true,
  },
  {
    code: 'EUR',
    name: 'Euro',
    // The euro spans several countries, so it has no single market.
    countryCode: null,
    symbol: '€',
    defaultRateToUsd: 0.92,
    autoSync: true,
  },
  {
    code: 'SDG',
    name: 'Sudanese Pound',
    countryCode: 'SD',
    symbol: 'ج.س',
    defaultRateToUsd: 1305,
    autoSync: true,
  },
  {
    code: 'BHD',
    name: 'Bahraini Dinar',
    countryCode: 'BH',
    symbol: '.د.ب',
    defaultRateToUsd: 0.377,
    autoSync: true,
  },
  {
    code: 'IQD',
    name: 'Iraqi Dinar',
    countryCode: 'IQ',
    symbol: 'ع.د',
    defaultRateToUsd: 1310,
    autoSync: true,
  },
  {
    code: 'KWD',
    name: 'Kuwaiti Dinar',
    countryCode: 'KW',
    symbol: 'د.ك',
    defaultRateToUsd: 0.307,
    autoSync: true,
  },
  {
    code: 'OMR',
    name: 'Omani Rial',
    countryCode: 'OM',
    symbol: 'ر.ع.',
    defaultRateToUsd: 0.385,
    autoSync: true,
  },
  {
    code: 'QAR',
    name: 'Qatari Riyal',
    countryCode: 'QA',
    symbol: 'ر.ق',
    defaultRateToUsd: 3.64,
    autoSync: true,
  },
  {
    code: 'SAR',
    name: 'Saudi Riyal',
    countryCode: 'SA',
    symbol: 'ر.س',
    defaultRateToUsd: 3.75,
    autoSync: true,
  },
  {
    code: 'AED',
    name: 'UAE Dirham',
    countryCode: 'AE',
    symbol: 'د.إ',
    defaultRateToUsd: 3.6725,
    autoSync: true,
  },
];

/** The base currency every conversion is expressed against. */
export const BASE_CURRENCY = 'USD';

export function currencyByCode(code: string): CurrencyDefinition | undefined {
  return CURRENCY_CATALOGUE.find((currency) => currency.code === code);
}
