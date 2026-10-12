import { CORE_RULES, NORMAL_RARITIES, UPGRADE_RULES } from '../data/rules'
import type { Rarity } from '../types/game'
import { finiteNumber, safeInteger } from './validation'

export function calculateAttack(pullPowerLevel: number): number {
  safeInteger(pullPowerLevel, 'PULL POWER level')
  return finiteNumber(CORE_RULES.initialAttack * UPGRADE_RULES.PULL_POWER.multiplier ** pullPowerLevel, 'attack')
}

/** Boss multiplier is a boundary for future channel-specific boss rules; default 1. */
export function calculateNormalDamage(attack: number, rarity: Rarity, flameActive = false, bossMultiplier = 1): number {
  finiteNumber(attack, 'attack')
  finiteNumber(bossMultiplier, 'bossMultiplier')
  if (!Object.hasOwn(NORMAL_RARITIES, rarity)) throw new RangeError('Unknown rarity')
  if (typeof flameActive !== 'boolean') throw new RangeError('Invalid FLAME state')
  return finiteNumber(
    attack * NORMAL_RARITIES[rarity].damageMultiplier *
      (flameActive ? CORE_RULES.flameNormalMultiplier : 1) * bossMultiplier,
    'normal damage',
  )
}

export function calculateResonanceDamage(attack: number, level: number, multiplier = 1, bossMultiplier = 1): number {
  finiteNumber(attack, 'attack')
  safeInteger(level, 'RESONANCE POWER level')
  finiteNumber(multiplier, 'resonance multiplier')
  finiteNumber(bossMultiplier, 'bossMultiplier')
  return finiteNumber(
    attack * CORE_RULES.resonanceBase * UPGRADE_RULES.RESONANCE_POWER.multiplier ** level *
      multiplier * bossMultiplier,
    'resonance damage',
  )
}
