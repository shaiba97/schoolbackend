import { BillingModel, PlanTier, PortalModule } from '@prisma/client';

export type PlanTierDefinition = {
  /** Stable code, unique on platform_plans. */
  code: string;
  name: string;
  tier: PlanTier;
  /** Audience line shown on the tier card. */
  target: string;
  billingModel: BillingModel;
  price: number;
  /** Upper bound when the tier is quoted as a range; null for a flat price. */
  priceMax: number | null;
  currency: string;
  /** Default license term in days. */
  durationDays: number;
  /** Card order in the console. */
  sortOrder: number;
  includedModules: PortalModule[];
  /** Feature entitlements, keyed by feature key. */
  features: Record<string, boolean | number | string>;
};

/**
 * Human labels for every feature key a tier can grant. A key without a
 * label is a bug: the console renders feature chips from this map, and a
 * missing label would surface as a blank chip.
 */
export const FEATURE_LABELS: Record<string, string> = {
  standardAttendance: 'Standard attendance',
  timetable: 'Timetable',
  examinations: 'Examinations',
  reportCards: 'Basic report cards',
  guardianPortal: 'Guardian web & mobile portal',
  whatsappAttendance: 'WhatsApp attendance triggers',
  smsAttendance: 'SMS attendance triggers',
  financialInstallments: 'Financial installments',
  payroll: 'Payroll',
  busTracking: 'Real-time bus tracking',
  gccTaxReceipts: 'ZATCA / GCC tax receipts',
  bespokeConfiguration: 'Bespoke portal configuration',
  databaseIsolation: 'Custom database isolation',
  dedicatedSla: 'Dedicated SLA',
};

/**
 * The platform tier catalogue. Prices are list prices in USD; a tier with a
 * range carries the entry price in `price` and the ceiling in `priceMax`.
 * This is business data rather than schema, so it ships here and is applied
 * by scripts/seed-platform-plans.mjs.
 */
export const PLAN_TIERS: PlanTierDefinition[] = [
  {
    code: 'PRIMARY',
    name: 'Primary Plan',
    tier: PlanTier.PRIMARY,
    target: 'Small schools and early-stage academies.',
    billingModel: BillingModel.ANNUAL,
    price: 800,
    priceMax: null,
    currency: 'USD',
    durationDays: 365,
    sortOrder: 1,
    includedModules: [
      PortalModule.ADMIN,
      PortalModule.ACADEMIC,
      PortalModule.STUDENT,
      PortalModule.TEACHER,
    ],
    features: {
      standardAttendance: true,
      timetable: true,
      examinations: true,
      reportCards: true,
    },
  },
  {
    code: 'INTERMEDIATE',
    name: 'Intermediate Plan',
    tier: PlanTier.INTERMEDIATE,
    target: 'Mid-size schools.',
    billingModel: BillingModel.ANNUAL,
    price: 1200,
    priceMax: null,
    currency: 'USD',
    durationDays: 365,
    sortOrder: 2,
    includedModules: [
      PortalModule.ADMIN,
      PortalModule.ACADEMIC,
      PortalModule.STUDENT,
      PortalModule.TEACHER,
      PortalModule.GUARDIAN,
    ],
    features: {
      standardAttendance: true,
      timetable: true,
      examinations: true,
      reportCards: true,
      guardianPortal: true,
      whatsappAttendance: true,
      smsAttendance: true,
    },
  },
  {
    code: 'ADVANCED',
    name: 'Advanced Plan',
    tier: PlanTier.ADVANCED,
    target: 'Large established private and GCC schools.',
    billingModel: BillingModel.ANNUAL,
    price: 3500,
    priceMax: 5500,
    currency: 'USD',
    durationDays: 365,
    sortOrder: 3,
    includedModules: [
      PortalModule.ADMIN,
      PortalModule.ACADEMIC,
      PortalModule.FINANCIAL,
      PortalModule.TEACHER,
      PortalModule.GUARDIAN,
      PortalModule.STUDENT,
      PortalModule.TRANSPORT,
    ],
    features: {
      standardAttendance: true,
      timetable: true,
      examinations: true,
      reportCards: true,
      guardianPortal: true,
      whatsappAttendance: true,
      smsAttendance: true,
      financialInstallments: true,
      payroll: true,
      busTracking: true,
      gccTaxReceipts: true,
    },
  },
  {
    code: 'CUSTOM',
    name: 'Customized Plan',
    tier: PlanTier.CUSTOM,
    target: 'School groups and multi-campus networks.',
    billingModel: BillingModel.ANNUAL,
    // Quote-based: no list price.
    price: 0,
    priceMax: null,
    currency: 'USD',
    durationDays: 365,
    sortOrder: 4,
    includedModules: [
      PortalModule.ADMIN,
      PortalModule.ACADEMIC,
      PortalModule.FINANCIAL,
      PortalModule.TEACHER,
      PortalModule.GUARDIAN,
      PortalModule.STUDENT,
      PortalModule.TRANSPORT,
    ],
    features: {
      bespokeConfiguration: true,
      databaseIsolation: true,
      dedicatedSla: true,
    },
  },
];

export function planTierByCode(code: string): PlanTierDefinition | undefined {
  return PLAN_TIERS.find((tier) => tier.code === code);
}

/** Feature keys of a tier, in the order the catalogue declares them. */
export function tierFeatureKeys(tier: PlanTierDefinition): string[] {
  return Object.keys(tier.features);
}
