import { CORE_RULES, SPECIAL_RESULTS, UPGRADE_RULES } from '../data/rules'
import type { RandomSource, SpecialResult } from '../types/game'
import { finiteNumber, safeInteger } from './validation'

/** Independent SPECIAL draw; consumes exactly one RNG value, no retry. */
export function drawSpecialPull(rng: RandomSource): SpecialResult {
  const roll = rng()
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('RandomSource must return a finite number in [0, 1)')
  let percent = 0
  for (const result of ['STRIKE', 'BURST', 'MEGA_BURST'] as const) {
    percent += Math.round(SPECIAL_RESULTS[result].probability * 100)
    if (roll < percent / 100) return result
  }
  throw new RangeError('SPECIAL distribution does not cover the roll')
}

/** SPECIAL-only channel; no normal, resonance or temporary multipliers. */
export function calculateSpecialDamage(attack: number, result: SpecialResult, level: number, bossMultiplier = 1): number {
  finiteNumber(attack, 'attack')
  safeInteger(level, 'SPECIAL POWER level')
  finiteNumber(bossMultiplier, 'SPECIAL boss multiplier')
  if (!Object.hasOwn(SPECIAL_RESULTS, result)) throw new RangeError('Unknown SPECIAL result')
  return finiteNumber(attack * SPECIAL_RESULTS[result].damageMultiplier * UPGRADE_RULES.SPECIAL_POWER.multiplier ** level * bossMultiplier, 'SPECIAL damage')
}

/** Safe fixed reservation without multiplying a potentially huge count by the cost. */
export function calculateSpecialMaxCount(gauge: number): number {
  return Math.floor(safeInteger(gauge, 'specialGauge') / CORE_RULES.specialGaugeCost)
}
