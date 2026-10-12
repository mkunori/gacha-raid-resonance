import { CORE_RULES, EFFECT_PROBABILITIES, FOCUS_PROBABILITIES, NORMAL_RARITIES } from '../data/rules'
import type { AdditionalEffect, Element, Focus, NormalPullResult, RandomSource, Rarity } from '../types/game'

const RARITIES = ['N', 'R', 'SR', 'SSR'] as const
const ELEMENTS = ['FIRE', 'WIND', 'THUNDER'] as const
const EFFECTS = ['NONE', 'CHAIN', 'CHARGE', 'BOOST'] as const

function draw<T extends string>(
  order: readonly T[],
  probability: (value: T) => number,
  rng: RandomSource,
): T {
  const roll = rng()
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new RangeError('RandomSource must return a finite number in [0, 1)')
  }

  // v0.6 uses whole percentages. Integer accumulation avoids 0.92 + 0.02
  // shifting the 0.94 boundary to 0.9400000000000001.
  let cumulativePercent = 0
  for (const value of order) {
    cumulativePercent += Math.round(probability(value) * 100)
    if (roll < cumulativePercent / 100) return value
  }
  throw new RangeError('Probability distribution does not cover the roll')
}

/**
 * Draws rarity → element → additional effect, exactly one RNG call each.
 * Intervals include their lower bound and exclude their upper bound.
 * Invalid focus consumes no RNG; an invalid roll throws immediately without retry.
 * Does not enforce Stage unlocks or apply any combat/additional effects.
 */
export function drawNormalPull(focus: Focus, rng: RandomSource): NormalPullResult {
  if (!Object.hasOwn(FOCUS_PROBABILITIES, focus)) {
    throw new RangeError('Unknown focus')
  }
  const rarity = draw<Rarity>(RARITIES, (value) => NORMAL_RARITIES[value].probability, rng)
  const element = draw<Element>(ELEMENTS, (value) => FOCUS_PROBABILITIES[focus][value], rng)
  const additionalEffect = draw<AdditionalEffect>(EFFECTS, (value) => EFFECT_PROBABILITIES[value], rng)
  return { rarity, element, additionalEffect }
}

/**
 * Returns new stacks with only the drawn element increased by H1, capped at 12.
 * All incoming stacks must be integers in [0, 12]. Invalid domain values throw.
 * Only element/rarity are read; additional effects and H2 are outside this API.
 */
export function applyNormalPullStacks(
  stacks: Readonly<Record<Element, number>>,
  result: Readonly<Pick<NormalPullResult, 'element' | 'rarity'>>,
): Record<Element, number> {
  for (const element of ELEMENTS) {
    if (!Number.isInteger(stacks[element]) || stacks[element] < 0 || stacks[element] > CORE_RULES.stackCap) {
      throw new RangeError('Each element stack must be an integer in [0, 12]')
    }
  }
  if (!ELEMENTS.includes(result.element) || !Object.hasOwn(NORMAL_RARITIES, result.rarity)) {
    throw new RangeError('Unknown element or rarity')
  }
  return {
    ...stacks,
    [result.element]: Math.min(
      CORE_RULES.stackCap,
      stacks[result.element] + NORMAL_RARITIES[result.rarity].stacks,
    ),
  }
}
