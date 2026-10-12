import { CORE_RULES } from '../data/rules'
import type { CombatEvent, CombatResult, GameState, RandomSource } from '../types/game'
import { applyBossDamage, calculateBossMaxHp, finishBossDefeat } from './boss'
import { calculateAttack, calculateNormalDamage } from './combat'
import { applyNormalPullStacks, drawNormalPull } from './gacha'
import { resolveResonances } from './resonance'
import { finiteNumber, safeInteger, validateFocus, validateStacks, validateTemporary } from './validation'

export function createInitialGameState(): GameState {
  return {
    stage: 1, highestStage: 1, bossHp: calculateBossMaxHp(1),
    stacks: { FIRE: 0, WIND: 0, THUNDER: 0 },
    specialGauge: 0, resonanceShards: 0,
    upgradeLevels: { PULL_POWER: 0, RESONANCE_POWER: 0, SPECIAL_POWER: 0 },
    spentShards: { PULL_POWER: 0, RESONANCE_POWER: 0, SPECIAL_POWER: 0 },
    catalyst: 0, focus: 'BALANCED',
    temporary: { boostCount: 0, thunderStormReserved: false, flameStormPullsRemaining: 0 },
    jackpot: { pullsInWindow: 0, ssrInWindow: 0 },
    pendingNormalPulls: 0,
    statistics: {
      totalNormalPulls: 0, totalSpecialPulls: 0, ssrCount: 0,
      resonanceCounts: { FLAME_STORM: 0, THUNDER_STORM: 0, OVERLOAD: 0 },
      bossesDefeated: 0, jackpotCount: 0,
    },
  }
}

function validateCombatState(state: Readonly<GameState>): void {
  const maxHp = calculateBossMaxHp(state.stage)
  safeInteger(state.highestStage, 'highestStage', state.stage)
  finiteNumber(state.bossHp, 'bossHp')
  if (state.bossHp <= 0 || state.bossHp > maxHp) throw new RangeError('Input boss must be alive with HP <= max HP')
  validateStacks(state.stacks)
  validateTemporary(state.temporary)
  validateFocus(state.focus)
  safeInteger(state.specialGauge, 'specialGauge')
  safeInteger(state.resonanceShards, 'resonanceShards')
  safeInteger(state.catalyst, 'catalyst', 0, CORE_RULES.catalystCap)
  safeInteger(state.pendingNormalPulls, 'pendingNormalPulls')
  for (const upgrade of ['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER'] as const) {
    safeInteger(state.upgradeLevels[upgrade], upgrade + ' level')
    safeInteger(state.spentShards[upgrade], upgrade + ' paid RS')
  }
  safeInteger(state.jackpot.pullsInWindow, 'JACKPOT window', 0, CORE_RULES.jackpotWindow - 1)
  safeInteger(state.jackpot.ssrInWindow, 'JACKPOT SSR', 0, state.jackpot.pullsInWindow)
  for (const key of ['totalNormalPulls', 'totalSpecialPulls', 'ssrCount', 'bossesDefeated', 'jackpotCount'] as const) {
    safeInteger(state.statistics[key], key)
  }
  for (const resonance of ['FLAME_STORM', 'THUNDER_STORM', 'OVERLOAD'] as const) {
    safeInteger(state.statistics.resonanceCounts[resonance], resonance + ' count')
  }
}

/**
 * One NORMAL PULL, exactly three RNG calls on valid input.
 * Every effect in this pull targets the original boss, even after HP reaches zero.
 * H2, additional-effect execution, JACKPOT, queues and special bosses are deferred.
 */
export function executeNormalPull(input: Readonly<GameState>, rng: RandomSource): CombatResult {
  validateCombatState(input)
  const attack = calculateAttack(input.upgradeLevels.PULL_POWER)
  const pull = drawNormalPull(input.focus, rng)
  const state: GameState = {
    ...input,
    stacks: { ...input.stacks },
    temporary: { ...input.temporary },
    upgradeLevels: { ...input.upgradeLevels },
    spentShards: { ...input.spentShards },
    jackpot: { ...input.jackpot },
    statistics: { ...input.statistics, resonanceCounts: { ...input.statistics.resonanceCounts } },
  }
  const events: CombatEvent[] = [{ type: 'normal-pull', stage: state.stage, result: pull }]
  const normalDamage = calculateNormalDamage(attack, pull.rarity, state.temporary.flameStormPullsRemaining > 0)
  state.bossHp = applyBossDamage(state.bossHp, normalDamage)
  state.temporary.flameStormPullsRemaining = Math.max(0, state.temporary.flameStormPullsRemaining - 1)
  events.push({ type: 'normal-damage', stage: state.stage, damage: normalDamage })
  state.stacks = applyNormalPullStacks(state.stacks, pull)
  // Future H2 acquisition belongs here, before resonance resolution.
  const resolved = resolveResonances(
    state.stacks, state.temporary, state.focus, attack, state.upgradeLevels.RESONANCE_POWER,
  )
  state.stacks = resolved.stacks
  state.temporary = resolved.temporary
  for (const activation of resolved.activations) {
    state.bossHp = applyBossDamage(state.bossHp, activation.damage)
    events.push({ type: 'resonance', stage: state.stage, ...activation })
    state.statistics.resonanceCounts[activation.resonance] = safeInteger(
      state.statistics.resonanceCounts[activation.resonance] + 1, 'resonance count',
    )
    if (activation.resonance === 'OVERLOAD') {
      events.push({ type: 'gauge-gained', stage: state.stage, amount: CORE_RULES.overloadGaugeGain, source: 'overload' })
    }
  }
  state.specialGauge = safeInteger(state.specialGauge + resolved.gaugeGain + CORE_RULES.normalGaugeGain, 'specialGauge')
  events.push({ type: 'gauge-gained', stage: state.stage, amount: CORE_RULES.normalGaugeGain, source: 'normal' })
  events.push({ type: 'additional-effect', stage: state.stage, effect: pull.additionalEffect, applied: false })
  state.statistics.totalNormalPulls = safeInteger(state.statistics.totalNormalPulls + 1, 'totalNormalPulls')
  if (pull.rarity === 'SSR') state.statistics.ssrCount = safeInteger(state.statistics.ssrCount + 1, 'ssrCount')
  const finished = finishBossDefeat(state)
  return { state: finished.state, events: [...events, ...finished.events] }
}
