import { CORE_RULES, FOCUS_RESONANCE, RESONANCE_ORDER, RESONANCE_PAIRS } from '../data/rules'
import type { Focus, GameState, Resonance } from '../types/game'
import { calculateResonanceDamage } from './combat'
import { finiteNumber, safeInteger, validateFocus, validateStacks, validateTemporary } from './validation'

export interface ResonanceResolution {
  stacks: GameState['stacks']
  temporary: GameState['temporary']
  gaugeGain: number
  catalyst: number
  activations: { resonance: Resonance; damage: number; catalystConsumed?: true; boostConsumed?: number }[]
}

export function findNextResonance(stacks: Readonly<GameState['stacks']>, focus: Focus): Resonance | null {
  validateStacks(stacks)
  validateFocus(focus)
  const eligible = (resonance: Resonance) =>
    RESONANCE_PAIRS[resonance].every((element) => stacks[element] >= CORE_RULES.resonanceStackCost)
  const preferred = FOCUS_RESONANCE[focus]
  if (preferred && eligible(preferred)) return preferred
  return RESONANCE_ORDER.find(eligible) ?? null
}

/** Resolve every eligible pair; consume at most one catalyst and all BOOST per resonance. */
export function resolveResonances(
  stacks: Readonly<GameState['stacks']>,
  temporary: Readonly<GameState['temporary']>,
  focus: Focus,
  attack: number,
  resonancePowerLevel: number,
  catalyst = 0,
): ResonanceResolution {
  validateStacks(stacks)
  validateTemporary(temporary)
  validateFocus(focus)
  finiteNumber(attack, 'attack')
  safeInteger(resonancePowerLevel, 'RESONANCE POWER level')
  safeInteger(catalyst, 'catalyst', 0, CORE_RULES.catalystCap)
  const result: ResonanceResolution = { stacks: { ...stacks }, temporary: { ...temporary }, catalyst, gaugeGain: 0, activations: [] }
  const limit = Math.floor(3 * CORE_RULES.stackCap / (2 * CORE_RULES.resonanceStackCost))
  for (let count = 0; ; count++) {
    const resonance = findNextResonance(result.stacks, focus)
    if (!resonance) return result
    if (count >= limit) throw new RangeError('Resonance resolution limit exceeded')
    for (const element of RESONANCE_PAIRS[resonance]) result.stacks[element] -= CORE_RULES.resonanceStackCost
    const catalystConsumed = result.catalyst > 0
    const boostConsumed = result.temporary.boostCount
    const multiplier = (result.temporary.thunderStormReserved ? CORE_RULES.thunderReservedMultiplier : 1) *
      (resonance === 'FLAME_STORM' ? CORE_RULES.flameResonanceMultiplier : 1) *
      (catalystConsumed ? CORE_RULES.catalystMultiplier : 1) *
      (1 + CORE_RULES.boostPerStack * boostConsumed)
    result.activations.push({ resonance, damage: calculateResonanceDamage(attack, resonancePowerLevel, multiplier),
      ...(catalystConsumed ? { catalystConsumed: true as const } : {}),
      ...(boostConsumed ? { boostConsumed } : {}),
    })
    if (catalystConsumed) result.catalyst--
    result.temporary.boostCount = 0
    result.temporary.thunderStormReserved = resonance === 'THUNDER_STORM'
    if (resonance === 'FLAME_STORM') result.temporary.flameStormPullsRemaining = CORE_RULES.flameDurationPulls
    if (resonance === 'OVERLOAD') result.gaugeGain += CORE_RULES.overloadGaugeGain
  }
}
