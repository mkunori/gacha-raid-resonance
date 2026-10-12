import { CORE_RULES, GAME_CLEAR_STAGE } from '../data/rules'
import { SPECIAL_BOSSES, type BossDefinition } from '../data/bosses'
import type { CombatEvent, CombatResult, Element, GameState, Resonance } from '../types/game'
import { hasClearedGame } from './progression'
import { finiteNumber, safeInteger } from './validation'

export interface BossInfo {
  readonly name: string
  readonly description: string
  readonly normalMultipliers: Readonly<Record<Element, number>>
  readonly resonanceMultipliers: Readonly<Record<Resonance, number>>
  readonly specialMultiplier: number
  readonly overloadGaugeGain: number
}

/** Detached trait data for UI and combat. Unlisted stages, including 51+, are ordinary. */
export function getBossInfo(stage: number): BossInfo {
  safeInteger(stage, 'stage', 1)
  const definition: BossDefinition = (SPECIAL_BOSSES as Readonly<Partial<Record<number, BossDefinition>>>)[stage] ?? { name: '通常ボス' }
  const normal = definition.normal?.reduce((product, factor) => product * factor, 1) ?? 1
  const resonance = definition.resonance?.reduce((product, factor) => product * factor, 1) ?? 1
  return {
    name: definition.name,
    description: `通常全般×${definition.normal?.join('×') ?? 1}、FIRE追加×${definition.fire ?? 1}。` +
      `共鳴全般×${definition.resonance?.join('×') ?? 1}、THUNDER STORM追加×${definition.thunderStorm ?? 1}。` +
      `SPECIAL×${definition.special ?? 1}。OVERLOADゲージ+${definition.overload ?? CORE_RULES.overloadGaugeGain}。`,
    normalMultipliers: { FIRE: normal * (definition.fire ?? 1), WIND: normal, THUNDER: normal },
    resonanceMultipliers: { FLAME_STORM: resonance, THUNDER_STORM: resonance * (definition.thunderStorm ?? 1), OVERLOAD: resonance },
    specialMultiplier: definition.special ?? 1,
    overloadGaugeGain: definition.overload ?? CORE_RULES.overloadGaugeGain,
  }
}

export function calculateBossMaxHp(stage: number): number {
  safeInteger(stage, 'stage', 1)
  return safeInteger(Math.ceil(CORE_RULES.bossHpBase * CORE_RULES.stageGrowth ** (stage - 1)), 'boss max HP', 1)
}

export function calculateBossReward(stage: number): number {
  safeInteger(stage, 'stage', 1)
  return safeInteger(Math.ceil(CORE_RULES.rewardBase * CORE_RULES.stageGrowth ** (stage - 1)), 'boss reward', 1)
}

/** HP may become negative inside a pull; transition is deliberately deferred. */
export function applyBossDamage(hp: number, damage: number): number {
  finiteNumber(hp, 'boss HP', -Number.MAX_SAFE_INTEGER)
  finiteNumber(damage, 'damage')
  return finiteNumber(hp - damage, 'remaining boss HP', -Number.MAX_SAFE_INTEGER)
}

/**
 * Call only at the end of a pull. First Stage 50 defeat records clear, then continues.
 * Never mutates input. A living boss returns the identical state reference.
 * On defeat, unchanged nested fields are structurally shared with input.
 * Treat input/output as immutable snapshots; clone before imperative edits.
 * executeNormalPull supplies its own detached working state at this boundary.
 */
export function finishBossDefeat(state: GameState): CombatResult {
  safeInteger(state.stage, 'stage', 1)
  finiteNumber(state.bossHp, 'boss HP', -Number.MAX_SAFE_INTEGER)
  if (state.bossHp > 0) return { state, events: [] }
  safeInteger(state.highestStage, 'highestStage', state.stage)
  safeInteger(state.resonanceShards, 'RS')
  safeInteger(state.statistics.bossesDefeated, 'bossesDefeated')
  const reward = calculateBossReward(state.stage)
  const stage = safeInteger(state.stage + 1, 'next stage', 1)
  const maxHp = calculateBossMaxHp(stage)
  const next: GameState = {
    ...state,
    stage,
    highestStage: Math.max(state.highestStage, stage),
    bossHp: maxHp,
    resonanceShards: safeInteger(state.resonanceShards + reward, 'RS'),
    stacks: { FIRE: 0, WIND: 0, THUNDER: 0 },
    temporary: { boostCount: 0, thunderStormReserved: false, flameStormPullsRemaining: 0 },
    statistics: {
      ...state.statistics,
      bossesDefeated: safeInteger(state.statistics.bossesDefeated + 1, 'bossesDefeated'),
    },
  }
  const events: CombatEvent[] = [
    { type: 'boss-defeated', stage: state.stage, reward },
    ...(state.stage === GAME_CLEAR_STAGE && !hasClearedGame(state)
      ? [{ type: 'game-cleared' as const, stage: state.stage }] : []),
    { type: 'stage-started', stage, maxHp },
  ]
  return { state: next, events }
}
