import { CORE_RULES } from '../data/rules'
import type { CombatEvent, CombatResult, GameState, NormalPullBatchResult, NormalPullCount, RandomSource, SpecialPullBatchResult, SpecialPullCount } from '../types/game'
import { applyBossDamage, calculateBossMaxHp, finishBossDefeat } from './boss'
import { calculateAttack, calculateNormalDamage } from './combat'
import { applyNormalPullStacks, drawNormalPull } from './gacha'
import { resolveResonances } from './resonance'
import { resolveJackpot } from './jackpot'
import { calculateSpecialDamage, calculateSpecialMaxCount, drawSpecialPull } from './special'
import { finiteNumber, safeInteger, validateFocus, validateJackpotWindow, validatePullQueues, validateStacks, validateTemporary } from './validation'

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
    pendingSpecialPulls: 0,
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
  validatePullQueues(state)
  for (const upgrade of ['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER'] as const) {
    safeInteger(state.upgradeLevels[upgrade], upgrade + ' level')
    safeInteger(state.spentShards[upgrade], upgrade + ' paid RS')
  }
  validateJackpotWindow(state.jackpot, state.stage)
  for (const key of ['totalNormalPulls', 'totalSpecialPulls', 'ssrCount', 'bossesDefeated', 'jackpotCount'] as const) {
    safeInteger(state.statistics[key], key)
  }
  for (const resonance of ['FLAME_STORM', 'THUNDER_STORM', 'OVERLOAD'] as const) {
    safeInteger(state.statistics.resonanceCounts[resonance], resonance + ' count')
  }
}

/** All mutable nested fields are detached before either kind of pull is applied. */
function cloneCombatState(input: Readonly<GameState>): GameState {
  return {
    ...input,
    stacks: { ...input.stacks }, temporary: { ...input.temporary },
    upgradeLevels: { ...input.upgradeLevels }, spentShards: { ...input.spentShards },
    jackpot: { ...input.jackpot }, normalPullQueue: { ...input.normalPullQueue },
    statistics: { ...input.statistics, resonanceCounts: { ...input.statistics.resonanceCounts } },
  }
}

/**
 * One NORMAL PULL, exactly three RNG calls on valid input.
 * Every effect in this pull targets the original boss, even after HP reaches zero.
 * Advances the CHAIN head, otherwise the base head, or one implicit base pull if empty.
 * This is a single actual-pull step, not a new batch action; generated CHAIN remains queued.
 * JACKPOT is resolved before finishBossDefeat; special bosses remain deferred.
 */
export function executeNormalPull(input: Readonly<GameState>, rng: RandomSource): CombatResult {
  validateCombatState(input)
  if (input.pendingSpecialPulls > 0) throw new RangeError('Resume pending SPECIAL before NORMAL')
  const attack = calculateAttack(input.upgradeLevels.PULL_POWER)
  const pull = drawNormalPull(input.focus, rng)
  const state = cloneCombatState(input)
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
  const jackpot = resolveJackpot(state.jackpot, state.stage, pull.rarity, attack)
  state.jackpot = jackpot.window
  if (jackpot.completed) {
    events.push({ type: 'jackpot-window', stage: state.stage, ssrCount: jackpot.ssrCount,
      triggered: jackpot.triggered, damage: jackpot.damage, gaugeGain: jackpot.gaugeGain })
    if (jackpot.triggered) {
      state.bossHp = applyBossDamage(state.bossHp, jackpot.damage)
      state.specialGauge = safeInteger(state.specialGauge + jackpot.gaugeGain, 'specialGauge')
      state.statistics.jackpotCount = safeInteger(state.statistics.jackpotCount + 1, 'jackpotCount')
      events.push({ type: 'gauge-gained', stage: state.stage, amount: jackpot.gaugeGain, source: 'jackpot' })
    }
  }
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
  if (input.pendingNormalPulls !== 0 || input.pendingSpecialPulls !== 0) throw new RangeError('Resume pending pulls before starting a new action')
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
  if (input.pendingSpecialPulls > 0) throw new RangeError('Resume pending SPECIAL before NORMAL')
  let state: GameState = input
  const summary: NormalPullBatchResult['summary'] = {
    actualPulls: 0, chainAdded: 0, pendingPulls: input.pendingNormalPulls,
    stagesAdvanced: 0, earnedShards: 0, ssrCount: 0, jackpotCount: 0,
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
      if (event.type === 'jackpot-window' && event.triggered) summary.jackpotCount++
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

/** One actual SPECIAL step; advances a reservation if present, otherwise one manual pull.
 * Costs 30 and consumes one RNG value. Never advances NORMAL effects or JACKPOT windows.
 */
export function executeSpecialPull(input: Readonly<GameState>, rng: RandomSource): CombatResult {
  validateCombatState(input)
  if (input.pendingNormalPulls > 0) throw new RangeError('Resume pending NORMAL before SPECIAL')
  if (input.specialGauge < CORE_RULES.specialGaugeCost) throw new RangeError('Insufficient SPECIAL gauge')
  const attack = calculateAttack(input.upgradeLevels.PULL_POWER)
  const pull = drawSpecialPull(rng)
  const damage = calculateSpecialDamage(attack, pull, input.upgradeLevels.SPECIAL_POWER)
  const state = cloneCombatState(input)
  state.specialGauge -= CORE_RULES.specialGaugeCost
  if (state.pendingSpecialPulls > 0) state.pendingSpecialPulls--
  state.bossHp = applyBossDamage(state.bossHp, damage)
  state.statistics.totalSpecialPulls = safeInteger(state.statistics.totalSpecialPulls + 1, 'totalSpecialPulls')
  const events: CombatEvent[] = [
    { type: 'special-pull', stage: state.stage, result: pull },
    { type: 'gauge-spent', stage: state.stage, amount: CORE_RULES.specialGaugeCost, source: 'special' },
    { type: 'special-damage', stage: state.stage, damage },
  ]
  const finished = finishBossDefeat(state)
  return { state: finished.state, events: [...events, ...finished.events] }
}

/** Reserves a fixed count at action start, never auto-invoked by NORMAL or gauge gain. */
export function executeSpecialPulls(
  input: Readonly<GameState>, count: SpecialPullCount, rng: RandomSource, limit: number = CORE_RULES.operationPullLimit,
): SpecialPullBatchResult {
  validateCombatState(input)
  validatePullLimit(limit)
  if (count !== 1 && count !== 'MAX') throw new RangeError('Unsupported SPECIAL count')
  if (input.pendingNormalPulls > 0 || input.pendingSpecialPulls > 0) throw new RangeError('Resume pending pulls before starting a new action')
  const reserved = count === 'MAX' ? calculateSpecialMaxCount(input.specialGauge) : 1
  if (input.specialGauge < CORE_RULES.specialGaugeCost) throw new RangeError('Insufficient SPECIAL gauge')
  return resumePendingSpecialPulls({ ...input, pendingSpecialPulls: reserved }, rng, limit)
}

/** Processes only the stored reservation, including across bosses; bounded aggregate output. */
export function resumePendingSpecialPulls(
  input: Readonly<GameState>, rng: RandomSource, limit: number = CORE_RULES.operationPullLimit,
): SpecialPullBatchResult {
  validateCombatState(input)
  validatePullLimit(limit)
  if (input.pendingNormalPulls > 0) throw new RangeError('Resume pending NORMAL before SPECIAL')
  let state: GameState = input
  const summary: SpecialPullBatchResult['summary'] = {
    actualPulls: 0, pendingPulls: input.pendingSpecialPulls, gaugeSpent: 0,
    stagesAdvanced: 0, earnedShards: 0, resultCounts: { STRIKE: 0, BURST: 0, MEGA_BURST: 0 },
  }
  while (state.pendingSpecialPulls > 0 && summary.actualPulls < limit) {
    const result = executeSpecialPull(state, rng)
    state = result.state
    summary.actualPulls++
    summary.gaugeSpent += CORE_RULES.specialGaugeCost
    for (const event of result.events) {
      if (event.type === 'special-pull') summary.resultCounts[event.result]++
      if (event.type === 'boss-defeated') {
        summary.stagesAdvanced++
        summary.earnedShards = safeInteger(summary.earnedShards + event.reward, 'batch RS')
      }
    }
  }
  summary.pendingPulls = state.pendingSpecialPulls
  return { state, summary }
}
