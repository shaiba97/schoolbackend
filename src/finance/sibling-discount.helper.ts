export type SiblingRelation = 'SISTERS' | 'BROTHERS' | 'SISTERS_AND_BROTHERS';
export type DiscountValueType = 'PERCENTAGE' | 'FIXED_AMOUNT';

export interface SiblingRuleLike {
  id: string;
  name: string;
  relationType: SiblingRelation;
  minSiblingCount: number;
  valueType: DiscountValueType;
  value: number;
  isActive: boolean;
}

export interface ComposedSiblingDiscount {
  ruleId: string;
  name: string;
  relationType: SiblingRelation;
  valueType: DiscountValueType;
  value: number;
  siblingCount: number;
}

/**
 * A rule applies to a group when the relations are identical, or when the rule
 * is the universal `SISTERS_AND_BROTHERS` type. A gender-specific rule never
 * applies to a different (or mixed) group.
 */
export function ruleMatchesRelation(
  ruleRelation: SiblingRelation,
  groupRelation: SiblingRelation,
): boolean {
  return (
    ruleRelation === groupRelation || ruleRelation === 'SISTERS_AND_BROTHERS'
  );
}

/**
 * Pure composition of a sibling discount for one group.
 *
 * `siblingCount` is the number of students in the group. Among every active
 * rule whose relation matches and whose `minSiblingCount` is met, the most
 * specific tier wins (highest `minSiblingCount`); ties break on the higher
 * `value`, then on the lexicographically smallest id so the outcome is stable.
 * Returns `null` when no rule qualifies.
 */
export function composeSiblingDiscount(
  groupRelation: SiblingRelation,
  siblingCount: number,
  rules: SiblingRuleLike[],
): ComposedSiblingDiscount | null {
  const eligible = rules
    .filter((r) => r.isActive)
    .filter((r) => ruleMatchesRelation(r.relationType, groupRelation))
    .filter((r) => r.minSiblingCount <= siblingCount);

  if (eligible.length === 0) return null;

  const best = eligible.reduce((a, b) => {
    if (b.minSiblingCount !== a.minSiblingCount) {
      return b.minSiblingCount > a.minSiblingCount ? b : a;
    }
    if (b.value !== a.value) return b.value > a.value ? b : a;
    return b.id < a.id ? b : a;
  });

  return {
    ruleId: best.id,
    name: best.name,
    relationType: best.relationType,
    valueType: best.valueType,
    value: best.value,
    siblingCount,
  };
}
