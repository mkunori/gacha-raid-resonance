import { CORE_RULES, NORMAL_RARITIES, UNLOCK_STAGES } from '../data/rules'
import type { GameState, Rarity } from '../types/game'
import { finiteNumber, validateJackpotWindow } from './validation'

export interface JackpotResolution {
  window: GameState['jackpot']
  completed: boolean
  triggered: boolean
  ssrCount: number
  damage: number
  gaugeGain: number
}

/** One actual NORMAL pull on its original Stage. SPECIAL must never call this function. */
export function resolveJackpot(window: Readonly<GameState['jackpot']>, stage: number, rarity: Rarity, attack: number): JackpotResolution {
  validateJackpotWindow(window, stage)
  finiteNumber(attack, 'attack')
  if (!Object.hasOwn(NORMAL_RARITIES, rarity)) throw new RangeError('Unknown rarity')
  const result: JackpotResolution = {
    window: { ...window }, completed: false, triggered: false, ssrCount: window.ssrInWindow, damage: 0, gaugeGain: 0,
  }
  if (stage < UNLOCK_STAGES.jackpot) return result
  result.window.pullsInWindow++
  if (rarity === 'SSR') result.window.ssrInWindow++
  result.ssrCount = result.window.ssrInWindow
  if (result.window.pullsInWindow === CORE_RULES.jackpotWindow) {
    result.completed = true
    result.triggered = result.ssrCount >= CORE_RULES.jackpotSsrThreshold
    if (result.triggered) {
      result.damage = finiteNumber(attack * CORE_RULES.jackpotAttackMultiplier, 'JACKPOT damage')
      result.gaugeGain = CORE_RULES.jackpotGaugeGain
    }
    result.window = { pullsInWindow: 0, ssrInWindow: 0 }
  }
  return result
}
