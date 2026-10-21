import { PortalModule } from '@prisma/client';

import {
  FEATURE_LABELS,
  PLAN_TIERS,
  planTierByCode,
  tierFeatureKeys,
} from './platform-plan-tiers';

describe('PLAN_TIERS', () => {
  it('defines exactly the four platform tiers in display order', () => {
    expect(PLAN_TIERS.map((tier) => tier.code)).toEqual([
      'PRIMARY',
      'INTERMEDIATE',
      'ADVANCED',
      'CUSTOM',
    ]);
    expect(PLAN_TIERS.map((tier) => tier.tier)).toEqual([
      'PRIMARY',
      'INTERMEDIATE',
      'ADVANCED',
      'CUSTOM',
    ]);
  });

  it('prices the tiers as agreed, with Advanced quoted as a range', () => {
    const primary = planTierByCode('PRIMARY');
    const intermediate = planTierByCode('INTERMEDIATE');
    const advanced = planTierByCode('ADVANCED');
    const custom = planTierByCode('CUSTOM');

    expect(primary?.price).toBe(800);
    expect(intermediate?.price).toBe(1200);
    expect(advanced?.price).toBe(3500);
    expect(advanced?.priceMax).toBe(5500);
    // Custom is quote-based: no list price, no ceiling.
    expect(custom?.price).toBe(0);
    expect(custom?.priceMax).toBeNull();
  });

  it('grants each tier the portals it promises', () => {
    expect(planTierByCode('PRIMARY')?.includedModules).toEqual([
      'ADMIN',
      'ACADEMIC',
      'STUDENT',
      'TEACHER',
    ]);
    expect(planTierByCode('INTERMEDIATE')?.includedModules).toEqual([
      'ADMIN',
      'ACADEMIC',
      'STUDENT',
      'TEACHER',
      'GUARDIAN',
    ]);
    expect(planTierByCode('ADVANCED')?.includedModules).toEqual([
      'ADMIN',
      'ACADEMIC',
      'FINANCIAL',
      'TEACHER',
      'GUARDIAN',
      'STUDENT',
      'TRANSPORT',
      'RECEPTION',
    ]);
  });

  it('gives every tier an audience line and a one-year term', () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.target.length).toBeGreaterThan(0);
      expect(tier.durationDays).toBe(365);
      expect(tier.currency).toBe('USD');
    }
  });

  it('only names portals that exist', () => {
    const known = Object.values(PortalModule);
    for (const tier of PLAN_TIERS) {
      for (const module of tier.includedModules) {
        expect(known).toContain(module);
      }
    }
  });

  it('gives every feature key a human label', () => {
    for (const tier of PLAN_TIERS) {
      for (const key of Object.keys(tier.features)) {
        expect(FEATURE_LABELS[key]).toBeDefined();
      }
    }
  });

  it('lists feature keys in the order the tiers declare them', () => {
    expect(tierFeatureKeys(planTierByCode('PRIMARY')!)).toEqual([
      'standardAttendance',
      'timetable',
      'examinations',
      'reportCards',
    ]);
    expect(tierFeatureKeys(planTierByCode('INTERMEDIATE')!)).toEqual(
      expect.arrayContaining([
        'standardAttendance',
        'guardianPortal',
        'whatsappAttendance',
        'smsAttendance',
      ]),
    );
    expect(tierFeatureKeys(planTierByCode('ADVANCED')!)).toEqual(
      expect.arrayContaining([
        'financialInstallments',
        'payroll',
        'busTracking',
        'gccTaxReceipts',
      ]),
    );
  });

  it('never grants a feature the tier does not enable', () => {
    const advanced = planTierByCode('ADVANCED')!;
    expect(advanced.features.financialInstallments).toBe(true);
    expect(advanced.features.dedicatedSla).toBeUndefined();
  });
});
