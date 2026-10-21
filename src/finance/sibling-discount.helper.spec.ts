import {
  composeSiblingDiscount,
  ruleMatchesRelation,
  SiblingRuleLike,
  SiblingRelation,
} from './sibling-discount.helper';

const rule = (over: Partial<SiblingRuleLike> = {}): SiblingRuleLike => ({
  id: 'r1',
  name: 'Rule',
  relationType: 'SISTERS_AND_BROTHERS',
  minSiblingCount: 2,
  valueType: 'PERCENTAGE',
  value: 5,
  isActive: true,
  ...over,
});

describe('ruleMatchesRelation', () => {
  it('matches an identical relation', () => {
    expect(ruleMatchesRelation('SISTERS', 'SISTERS')).toBe(true);
    expect(ruleMatchesRelation('BROTHERS', 'BROTHERS')).toBe(true);
  });

  it('treats SISTERS_AND_BROTHERS as universal', () => {
    const groups: SiblingRelation[] = ['SISTERS', 'BROTHERS', 'SISTERS_AND_BROTHERS'];
    for (const g of groups) {
      expect(ruleMatchesRelation('SISTERS_AND_BROTHERS', g)).toBe(true);
    }
  });

  it('never applies a gender-specific rule to a different or mixed group', () => {
    expect(ruleMatchesRelation('SISTERS', 'BROTHERS')).toBe(false);
    expect(ruleMatchesRelation('SISTERS', 'SISTERS_AND_BROTHERS')).toBe(false);
    expect(ruleMatchesRelation('BROTHERS', 'SISTERS')).toBe(false);
  });
});

describe('composeSiblingDiscount', () => {
  it('returns null when there are no rules', () => {
    expect(composeSiblingDiscount('SISTERS', 3, [])).toBeNull();
  });

  it('ignores inactive rules', () => {
    expect(
      composeSiblingDiscount('BROTHERS', 3, [rule({ isActive: false })]),
    ).toBeNull();
  });

  it('requires the sibling count to meet the rule threshold', () => {
    expect(
      composeSiblingDiscount('SISTERS', 1, [rule({ minSiblingCount: 2 })]),
    ).toBeNull();
    expect(
      composeSiblingDiscount('SISTERS', 2, [rule({ minSiblingCount: 2 })]),
    ).not.toBeNull();
  });

  it('filters out rules whose relation does not match the group', () => {
    expect(
      composeSiblingDiscount('BROTHERS', 3, [
        rule({ relationType: 'SISTERS' }),
      ]),
    ).toBeNull();
  });

  it('applies a universal rule to any group', () => {
    const r = rule({ relationType: 'SISTERS_AND_BROTHERS', value: 7 });
    expect(composeSiblingDiscount('SISTERS', 3, [r])?.ruleId).toBe('r1');
    expect(composeSiblingDiscount('BROTHERS', 3, [r])?.ruleId).toBe('r1');
    expect(
      composeSiblingDiscount('SISTERS_AND_BROTHERS', 3, [r])?.ruleId,
    ).toBe('r1');
  });

  it('picks the most specific tier (highest minSiblingCount)', () => {
    const result = composeSiblingDiscount('SISTERS_AND_BROTHERS', 4, [
      rule({ id: 'low', minSiblingCount: 2, value: 20 }),
      rule({ id: 'high', minSiblingCount: 4, value: 5 }),
    ]);
    expect(result?.ruleId).toBe('high');
  });

  it('breaks a tier tie on the higher value', () => {
    const result = composeSiblingDiscount('SISTERS_AND_BROTHERS', 3, [
      rule({ id: 'a', minSiblingCount: 2, value: 5 }),
      rule({ id: 'b', minSiblingCount: 2, value: 10 }),
    ]);
    expect(result?.ruleId).toBe('b');
  });

  it('breaks a value tie deterministically on the smaller id', () => {
    const result = composeSiblingDiscount('SISTERS_AND_BROTHERS', 3, [
      rule({ id: 'zzz', minSiblingCount: 2, value: 10 }),
      rule({ id: 'aaa', minSiblingCount: 2, value: 10 }),
    ]);
    expect(result?.ruleId).toBe('aaa');
  });

  it('preserves the value type and reports the sibling count', () => {
    const result = composeSiblingDiscount('BROTHERS', 2, [
      rule({ valueType: 'FIXED_AMOUNT', value: 150, relationType: 'BROTHERS' }),
    ]);
    expect(result).toEqual({
      ruleId: 'r1',
      name: 'Rule',
      relationType: 'BROTHERS',
      valueType: 'FIXED_AMOUNT',
      value: 150,
      siblingCount: 2,
    });
  });
});
