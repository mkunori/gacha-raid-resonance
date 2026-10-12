import { CORE_RULES } from '../data/rules'
import type { CombatResult, GameState } from '../types/game'
import { finiteNumber, safeInteger } from './validation'

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
 * Call only at the end of a pull. No Stage 50 terminal policy is imposed.
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
  return { state: next, events: [
    { type: 'boss-defeated', stage: state.stage, reward },
    { type: 'stage-started', stage, maxHp },
  ] }
}
