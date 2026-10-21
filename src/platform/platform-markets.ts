/**
 * The markets the platform sells into, and what each one bills in.
 *
 * The console offers a country, and the currency and timezone follow from
 * it, so an operator never types a mismatched SDG/Asia/Khartoum triple. The
 * backend derives the same values from the same table, so the values a
 * school ends up with do not depend on which client sent the request.
 */
export type MarketDefinition = {
  /** ISO 3166-1 alpha-2 country code. */
  code: string;
  name: string;
  /** Arabic name, for the bilingual console. */
  nameAr: string;
  currency: string;
  timezone: string;
  /** Dial code, shown as a hint next to the phone field. */
  dialCode: string;
};

export const MARKETS: MarketDefinition[] = [
  {
    code: 'SD',
    name: 'Sudan',
    nameAr: 'السودان',
    currency: 'SDG',
    timezone: 'Africa/Khartoum',
    dialCode: '+249',
  },
  {
    code: 'BH',
    name: 'Bahrain',
    nameAr: 'البحرين',
    currency: 'BHD',
    timezone: 'Asia/Bahrain',
    dialCode: '+973',
  },
  {
    code: 'EG',
    name: 'Egypt',
    nameAr: 'مصر',
    currency: 'EGP',
    timezone: 'Africa/Cairo',
    dialCode: '+20',
  },
  {
    code: 'IQ',
    name: 'Iraq',
    nameAr: 'العراق',
    currency: 'IQD',
    timezone: 'Asia/Baghdad',
    dialCode: '+964',
  },
  {
    code: 'KW',
    name: 'Kuwait',
    nameAr: 'الكويت',
    currency: 'KWD',
    timezone: 'Asia/Kuwait',
    dialCode: '+965',
  },
  {
    code: 'OM',
    name: 'Oman',
    nameAr: 'عُمان',
    currency: 'OMR',
    timezone: 'Asia/Muscat',
    dialCode: '+968',
  },
  {
    code: 'QA',
    name: 'Qatar',
    nameAr: 'قطر',
    currency: 'QAR',
    timezone: 'Asia/Qatar',
    dialCode: '+974',
  },
  {
    code: 'SA',
    name: 'Saudi Arabia',
    nameAr: 'السعودية',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    dialCode: '+966',
  },
  {
    code: 'AE',
    name: 'United Arab Emirates',
    nameAr: 'الإمارات',
    currency: 'AED',
    timezone: 'Asia/Dubai',
    dialCode: '+971',
  },
];

export function marketByCode(code: string): MarketDefinition | undefined {
  return MARKETS.find((market) => market.code === code.toUpperCase());
}

/** The currency and timezone a market bills in. */
export function marketDefaults(code: string): {
  currency: string;
  timezone: string;
} {
  const market = marketByCode(code);
  return {
    currency: market?.currency ?? 'USD',
    timezone: market?.timezone ?? 'UTC',
  };
}
