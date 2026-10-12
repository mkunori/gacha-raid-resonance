import { CORE_RULES } from '../data/rules'
import type { CombatEvent, CombatResult, GameState, NormalPullBatchResult, NormalPullCount, RandomSource } from '../types/game'
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
    normalPullQueue: { base: 0, chain: 0 },
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
  safeInteger(state.normalPullQueue.base, 'pending base pulls')
  safeInteger(state.normalPullQueue.chain, 'pending CHAIN pulls')
  if (safeInteger(state.normalPullQueue.base + state.normalPullQueue.chain, 'queue sum') !== state.pendingNormalPulls) {
    throw new RangeError('Queue sum must equal pendingNormalPulls')
  }
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
 * Advances the CHAIN head, otherwise the base head, or one implicit base pull if empty.
 * This is a single actual-pull step, not a new batch action; generated CHAIN remains queued.
 * JACKPOT belongs immediately before finishBossDefeat; special bosses remain deferred.
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
    normalPullQueue: { ...input.normalPullQueue },
    statistics: { ...input.statistics, resonanceCounts: { ...input.statistics.resonanceCounts } },
  }
  if (state.normalPullQueue.chain > 0) state.normalPullQueue.chain--
  else if (state.normalPullQueue.base > 0) state.normalPullQueue.base--
  const events: CombatEvent[] = [{ type: 'normal-pull', stage: state.stage, result: pull }]
  const normalDamage = calculateNormalDamage(attack, pull.rarity, state.temporary.flameStormPullsRemaining > 0)
  state.bossHp = applyBossDamage(state.bossHp, normalDamage)
  state.temporary.flameStormPullsRemaining = Math.max(0, state.temporary.flameStormPullsRemaining - 1)
  events.push({ type: 'normal-damage', stage: state.stage, damage: normalDamage })
  state.stacks = applyNormalPullStacks(state.stacks, pull)
  if (pull.rarity === 'SSR') {
    const before = state.catalyst
    state.catalyst = Math.min(CORE_RULES.catalystCap, before + 1)
    events.push({ type: 'catalyst-gained', stage: state.stage, amount: state.catalyst - before })
  }
  const resolved = resolveResonances(
    state.stacks, state.temporary, state.focus, attack, state.upgradeLevels.RESONANCE_POWER, state.catalyst,
  )
  state.stacks = resolved.stacks
  state.temporary = resolved.temporary
  state.catalyst = resolved.catalyst
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
  let amount = 0
  if (pull.additionalEffect === 'CHAIN') {
    amount = CORE_RULES.chainPulls
    state.normalPullQueue.chain = safeInteger(state.normalPullQueue.chain + amount, 'CHAIN queue')
  } else if (pull.additionalEffect === 'CHARGE') {
    amount = CORE_RULES.chargeGaugeGain
    state.specialGauge = safeInteger(state.specialGauge + amount, 'specialGauge')
    events.push({ type: 'gauge-gained', stage: state.stage, amount, source: 'charge' })
  } else if (pull.additionalEffect === 'BOOST') {
    const before = state.temporary.boostCount
    state.temporary.boostCount = Math.min(CORE_RULES.boostCap, before + 1)
    amount = state.temporary.boostCount - before
  }
  state.pendingNormalPulls = safeInteger(state.normalPullQueue.base + state.normalPullQueue.chain, 'pendingNormalPulls')
  events.push({ type: 'additional-effect', stage: state.stage, effect: pull.additionalEffect,
    applied: pull.additionalEffect !== 'NONE', ...(pull.additionalEffect !== 'NONE' ? { amount } : {}),
  })
  state.statistics.totalNormalPulls = safeInteger(state.statistics.totalNormalPulls + 1, 'totalNormalPulls')
  if (pull.rarity === 'SSR') state.statistics.ssrCount = safeInteger(state.statistics.ssrCount + 1, 'ssrCount')
  const finished = finishBossDefeat(state)
  return { state: finished.state, events: [...events, ...finished.events] }
}

function validatePullLimit(limit: number): void {
  safeInteger(limit, 'actual pull limit', 1, CORE_RULES.operationPullLimit)
}

/** Start an action only when the previous action is fully drained. No Stage unlock checks yet. */
export function executeNormalPulls(
  input: Readonly<GameState>, count: NormalPullCount, rng: RandomSource,
  limit: number = CORE_RULES.operationPullLimit,
): NormalPullBatchResult {
  validateCombatState(input)
  validatePullLimit(limit)
  if (![1, 10, 100, 1000].includes(count)) throw new RangeError('Unsupported NORMAL PULL count')
  if (input.pendingNormalPulls !== 0) throw new RangeError('Resume pending pulls before starting a new action')
  return resumePendingNormalPulls({ ...input, pendingNormalPulls: count, normalPullQueue: { base: count, chain: 0 } }, rng, limit)
}

/** Drain the serializable queue iteratively. RNG is consumed only by actual pulls (three calls each).
 * Resuming requires the same RNG continuation; an exception never mutates input but may consume RNG.
 * All queued CHAIN pulls are interchangeable, so FIFO needs counters rather than an item array.
 */
export function resumePendingNormalPulls(
  input: Readonly<GameState>, rng: RandomSource, limit: number = CORE_RULES.operationPullLimit,
): NormalPullBatchResult {
  validateCombatState(input)
  validatePullLimit(limit)
  let state: GameState = input
  const summary: NormalPullBatchResult['summary'] = {
    actualPulls: 0, chainAdded: 0, pendingPulls: input.pendingNormalPulls,
    stagesAdvanced: 0, earnedShards: 0, ssrCount: 0,
    resonanceCounts: { FLAME_STORM: 0, THUNDER_STORM: 0, OVERLOAD: 0 },
    effectCounts: { NONE: 0, CHAIN: 0, CHARGE: 0, BOOST: 0 },
  }
  while (state.pendingNormalPulls > 0 && summary.actualPulls < limit) {
    const result = executeNormalPull(state, rng)
    state = result.state
    summary.actualPulls++
    for (const event of result.events) {
      if (event.type === 'normal-pull' && event.result.rarity === 'SSR') summary.ssrCount++
      if (event.type === 'resonance') summary.resonanceCounts[event.resonance]++
      if (event.type === 'additional-effect') {
        summary.effectCounts[event.effect]++
        if (event.effect === 'CHAIN') summary.chainAdded += CORE_RULES.chainPulls
      }
      if (event.type === 'boss-defeated') {
        summary.stagesAdvanced++
        summary.earnedShards = safeInteger(summary.earnedShards + event.reward, 'batch RS')
      }
    }
  }
  summary.pendingPulls = state.pendingNormalPulls
  return { state, summary }
}
