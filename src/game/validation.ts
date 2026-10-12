import { CORE_RULES, FOCUS_PROBABILITIES } from '../data/rules'
import type { Focus, GameState } from '../types/game'

/** Reject overflow instead of silently losing integer resources or counters. */
export function safeInteger(value: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(name + ' must be a safe integer in [' + min + ', ' + max + ']')
  }
  return value
}

export function finiteNumber(value: number, name: string, min = 0): number {
  if (!Number.isFinite(value) || value < min || value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(name + ' must be finite and within the safe numeric range')
  }
  return value
}

export function validateFocus(focus: Focus): void {
  if (!Object.hasOwn(FOCUS_PROBABILITIES, focus)) throw new RangeError('Unknown focus')
}

export function validateStacks(stacks: Readonly<GameState['stacks']>): void {
  for (const element of ['FIRE', 'WIND', 'THUNDER'] as const) {
    safeInteger(stacks[element], element + ' stacks', 0, CORE_RULES.stackCap)
  }
}

export function validateTemporary(temporary: Readonly<GameState['temporary']>): void {
  safeInteger(temporary.boostCount, 'boostCount', 0, CORE_RULES.boostCap)
  safeInteger(temporary.flameStormPullsRemaining, 'flameStormPullsRemaining', 0, CORE_RULES.flameDurationPulls)
  if (typeof temporary.thunderStormReserved !== 'boolean') throw new RangeError('Invalid THUNDER reservation')
}
