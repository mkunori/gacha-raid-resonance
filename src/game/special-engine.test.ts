import { describe, expect, it, vi } from 'vitest'
import { seededRng, sequenceRng } from '../test/random'
import type { GameState, SpecialPullCount } from '../types/game'
import { calculateBossMaxHp, calculateBossReward } from './boss'
import {
  createInitialGameState, executeNormalPull, executeNormalPulls, executeSpecialPull, executeSpecialPulls,
  resumePendingNormalPulls, resumePendingSpecialPulls,
} from './engine'

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

const charged = (gauge = 30) => ({ ...createInitialGameState(), specialGauge: gauge })

describe('manual SPECIAL step', () => {
  it.each([[30, 0], [59, 29], [60, 30]] as const)('spends 30 from %s, leaving %s with one RNG call', (gauge, remaining) => {
    const input = freezeDeep(charged(gauge))
    const rng = vi.fn(() => 0)
    const result = executeSpecialPull(input, rng)
    expect(result.state.specialGauge).toBe(remaining)
    expect(result.state.bossHp).toBe(900)
    expect(result.state.statistics.totalSpecialPulls).toBe(1)
    expect(rng).toHaveBeenCalledTimes(1)
    expect(result.events).toEqual([
      { type: 'special-pull', stage: 1, result: 'STRIKE' },
      { type: 'gauge-spent', stage: 1, amount: 30, source: 'special' },
      { type: 'special-damage', stage: 1, damage: 200 },
    ])
    expect(input.specialGauge).toBe(gauge)
  })
  it.each([0, 29])('rejects gauge %s for single and MAX before consuming RNG', (gauge) => {
    const state = freezeDeep(charged(gauge))
    const rng = vi.fn(() => 0)
    expect(() => executeSpecialPull(state, rng)).toThrow(RangeError)
    expect(() => executeSpecialPulls(state, 1, rng)).toThrow(RangeError)
    expect(() => executeSpecialPulls(state, 'MAX', rng)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
    expect(state).toEqual(charged(gauge))
  })
  it('leaves NORMAL buffs, stacks, H2, jackpot window and statistics untouched on survival', () => {
    const state = charged(60)
    state.stage = state.highestStage = 20
    state.bossHp = calculateBossMaxHp(20)
    state.stacks = { FIRE: 3, WIND: 3, THUNDER: 3 }
    state.catalyst = 3
    state.temporary = { boostCount: 3, thunderStormReserved: true, flameStormPullsRemaining: 10 }
    state.jackpot = { pullsInWindow: 99, ssrInWindow: 3 }
    const before = structuredClone(state)
    const result = executeSpecialPull(freezeDeep(state), () => 0.95)
    expect(result.state).toEqual({ ...before, bossHp: before.bossHp - 1000, specialGauge: 30,
      statistics: { ...before.statistics, totalSpecialPulls: 1 } })
    expect(state).toEqual(before)
    // All nested working data is detached, including fields SPECIAL did not update.
    result.state.stacks.FIRE = 0
    result.state.temporary.boostCount = 0
    result.state.jackpot.pullsInWindow = 0
    result.state.statistics.resonanceCounts.OVERLOAD = 1
    result.state.upgradeLevels.PULL_POWER = 1
    result.state.normalPullQueue.base = 1
    expect(state).toEqual(before)
  })
  it('applies PULL POWER and SPECIAL POWER but no normal/resonance buffs', () => {
    const state = charged()
    state.upgradeLevels.PULL_POWER = 1
    state.upgradeLevels.SPECIAL_POWER = 2
    state.upgradeLevels.RESONANCE_POWER = 5
    state.temporary = { boostCount: 3, thunderStormReserved: true, flameStormPullsRemaining: 10 }
    state.catalyst = 3
    const result = executeSpecialPull(state, () => 0.75)
    const damage = result.events.find((e) => e.type === 'special-damage')!.damage
    expect(damage).toBeCloseTo(12 * 40 * 1.1 ** 2)
    expect(result.state.bossHp).toBeCloseTo(1100 - damage)
  })
  it('finishes defeat once after SPECIAL and preserves jackpot, catalyst and remaining reservation', () => {
    const state = charged(91)
    state.stage = state.highestStage = 20
    state.bossHp = 1
    state.catalyst = 3
    state.pendingSpecialPulls = 3
    state.temporary = { boostCount: 3, thunderStormReserved: true, flameStormPullsRemaining: 10 }
    state.stacks.FIRE = 12
    state.jackpot = { pullsInWindow: 99, ssrInWindow: 3 }
    const result = executeSpecialPull(freezeDeep(state), () => 0.95)
    expect(result.state.stage).toBe(21)
    expect(result.state.bossHp).toBe(calculateBossMaxHp(21))
    expect(result.state.resonanceShards).toBe(calculateBossReward(20))
    expect(result.state.statistics.bossesDefeated).toBe(1)
    expect(result.state.pendingSpecialPulls).toBe(2)
    expect(result.state.specialGauge).toBe(61)
    expect(result.state.catalyst).toBe(3)
    expect(result.state.jackpot).toEqual(state.jackpot)
    expect(result.state.temporary).toEqual(createInitialGameState().temporary)
    expect(result.state.stacks).toEqual(createInitialGameState().stacks)
    expect(result.events.map((e) => e.type)).toEqual(['special-pull', 'gauge-spent', 'special-damage', 'boss-defeated', 'stage-started'])
    expect(result.events.filter((e) => e.type !== 'stage-started').every((e) => e.stage === 20)).toBe(true)
  })
})

describe('SPECIAL MAX and resumable reservation', () => {
  it('reserves at start, crosses stages, discards overkill and keeps the gauge remainder', () => {
    const state = charged(91)
    state.bossHp = 1
    const rng = vi.fn(sequenceRng([0.95, 0.95, 0.95]))
    const result = executeSpecialPulls(freezeDeep(state), 'MAX', rng)
    expect(result.state.stage).toBe(3)
    expect(result.state.bossHp).toBe(calculateBossMaxHp(3))
    expect(result.state.specialGauge).toBe(1)
    expect(result.state.pendingSpecialPulls).toBe(0)
    expect(result.summary).toEqual({ actualPulls: 3, pendingPulls: 0, gaugeSpent: 90,
      stagesAdvanced: 2, earnedShards: calculateBossReward(1) + calculateBossReward(2),
      resultCounts: { STRIKE: 0, BURST: 0, MEGA_BURST: 3 } })
    expect(rng).toHaveBeenCalledTimes(3)
  })
  it.each([1, 7, 31])('matches MAX, x1 repetition and chunks of %s on seed 42, including summaries', (limit) => {
    const initial = charged(30 * 101 + 17)
    const batchRng = vi.fn(seededRng(42))
    const full = executeSpecialPulls(initial, 'MAX', batchRng)
    const stepRng = vi.fn(seededRng(42))
    let stepped = initial
    for (let i = 0; i < 101; i++) stepped = executeSpecialPulls(stepped, 1, stepRng).state
    expect(stepped).toEqual(full.state)
    const rng = vi.fn(seededRng(42))
    let chunk = executeSpecialPulls(freezeDeep(initial), 'MAX', rng, limit)
    const aggregate = { ...chunk.summary, resultCounts: { ...chunk.summary.resultCounts } }
    while (chunk.state.pendingSpecialPulls > 0) {
      const saved: GameState = JSON.parse(JSON.stringify(chunk.state))
      chunk = resumePendingSpecialPulls(freezeDeep(saved), rng, limit)
      aggregate.actualPulls += chunk.summary.actualPulls
      aggregate.gaugeSpent += chunk.summary.gaugeSpent
      aggregate.stagesAdvanced += chunk.summary.stagesAdvanced
      aggregate.earnedShards += chunk.summary.earnedShards
      for (const result of ['STRIKE', 'BURST', 'MEGA_BURST'] as const) aggregate.resultCounts[result] += chunk.summary.resultCounts[result]
      aggregate.pendingPulls = chunk.summary.pendingPulls
    }
    expect(chunk.state).toEqual(full.state)
    expect(aggregate).toEqual(full.summary)
    expect(batchRng).toHaveBeenCalledTimes(101)
    expect(stepRng).toHaveBeenCalledTimes(101)
    expect(rng).toHaveBeenCalledTimes(101)
    expect(rng()).toBe(batchRng())
  })
  it('never recalculates the reservation on resume, even with additional gauge', () => {
    const paused = executeSpecialPulls(charged(90), 'MAX', () => 0, 1).state
    expect(paused.pendingSpecialPulls).toBe(2)
    const updated = { ...paused, specialGauge: paused.specialGauge + 60 }
    const result = resumePendingSpecialPulls(updated, () => 0)
    expect(result.summary.actualPulls).toBe(2)
    expect(result.state.specialGauge).toBe(60)
  })
  it('stops exactly at 100,000 with a completed SPECIAL, keeps fixed remainder and bounds output', () => {
    const state = freezeDeep(charged(100_001 * 30 + 17))
    const rng = vi.fn(() => 0)
    const result = executeSpecialPulls(state, 'MAX', rng)
    expect(result.summary.actualPulls).toBe(100_000)
    expect(result.summary.gaugeSpent).toBe(3_000_000)
    expect(result.summary.pendingPulls).toBe(1)
    expect(result.state.specialGauge).toBe(47)
    expect(rng).toHaveBeenCalledTimes(100_000)
    expect('events' in result).toBe(false)
    expect(JSON.stringify(result.summary).length).toBeLessThan(400)
    const next = resumePendingSpecialPulls(result.state, rng)
    expect(next.summary.actualPulls).toBe(1)
    expect(next.state.pendingSpecialPulls).toBe(0)
    expect(next.state.specialGauge).toBe(17)
    expect(rng).toHaveBeenCalledTimes(100_001)
    expect(state.specialGauge).toBe(3_000_047)
  })
  it('accepts MAX_SAFE_INTEGER gauge without allocating an array per reservation', () => {
    const result = executeSpecialPulls(charged(Number.MAX_SAFE_INTEGER), 'MAX', () => 0, 1)
    expect(result.state.pendingSpecialPulls).toBe(Math.floor(Number.MAX_SAFE_INTEGER / 30) - 1)
    expect(result.state.specialGauge).toBe(Number.MAX_SAFE_INTEGER - 30)
  })
  it('resumes an empty SPECIAL queue without RNG or modifying state', () => {
    const state = freezeDeep(charged(90))
    const rng = vi.fn(() => 0)
    const result = resumePendingSpecialPulls(state, rng)
    expect(result.state).toBe(state)
    expect(result.summary.actualPulls).toBe(0)
    expect(result.state.specialGauge).toBe(90)
    expect(rng).not.toHaveBeenCalled()
  })
})

describe('SPECIAL queue guards and atomic failure', () => {
  it('rejects all NORMAL entry points and new SPECIAL actions during pending SPECIAL', () => {
    const state = executeSpecialPulls(charged(90), 'MAX', () => 0, 1).state
    const before = structuredClone(state)
    const rng = vi.fn(() => 0)
    expect(() => executeNormalPull(freezeDeep(state), rng)).toThrow(RangeError)
    expect(() => executeNormalPulls(state, 1, rng)).toThrow(RangeError)
    expect(() => resumePendingNormalPulls(state, rng)).toThrow(RangeError)
    expect(() => executeSpecialPulls(state, 1, rng)).toThrow(RangeError)
    expect(() => executeSpecialPulls(state, 'MAX', rng)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
    expect(state).toEqual(before)
  })
  it('rejects all SPECIAL entry points during pending NORMAL/CHAIN', () => {
    const state = executeNormalPulls(charged(90), 1, sequenceRng([0, 0, 0.93]), 1).state
    const rng = vi.fn(() => 0)
    expect(() => executeSpecialPull(state, rng)).toThrow(RangeError)
    expect(() => executeSpecialPulls(state, 1, rng)).toThrow(RangeError)
    expect(() => executeSpecialPulls(state, 'MAX', rng)).toThrow(RangeError)
    expect(() => resumePendingSpecialPulls(state, rng)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
  })
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 3])('rejects invalid or unaffordable pending count %s', (pending) => {
    const state = { ...charged(60), pendingSpecialPulls: pending }
    const rng = vi.fn(() => 0)
    expect(() => resumePendingSpecialPulls(freezeDeep(state), rng)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
  })
  it('rejects simultaneous NORMAL and SPECIAL queues before RNG', () => {
    const state = { ...charged(60), pendingSpecialPulls: 1, pendingNormalPulls: 1, normalPullQueue: { base: 1, chain: 0 } }
    const rng = vi.fn(() => 0)
    expect(() => resumePendingSpecialPulls(state, rng)).toThrow(/coexist/)
    expect(() => resumePendingNormalPulls(state, rng)).toThrow(/coexist/)
    expect(rng).not.toHaveBeenCalled()
  })
  it.each([0, -1, 1.5, 100_001, NaN, Infinity])('rejects invalid SPECIAL limit %s before RNG', (limit) => {
    const rng = vi.fn(() => 0)
    expect(() => executeSpecialPulls(charged(), 'MAX', rng, limit)).toThrow(RangeError)
    expect(() => resumePendingSpecialPulls(charged(), rng, limit)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
  })
  it.each([0, 2, 'bad', NaN])('rejects invalid SPECIAL action %s before RNG', (count) => {
    const rng = vi.fn(() => 0)
    expect(() => executeSpecialPulls(charged(), count as SpecialPullCount, rng)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
  })
  it.each(['special count', 'RS', 'boss count', 'SPECIAL damage'] as const)('rejects %s overflow without input mutation', (field) => {
    const state = charged()
    if (field === 'special count') state.statistics.totalSpecialPulls = Number.MAX_SAFE_INTEGER
    if (field === 'RS') { state.resonanceShards = Number.MAX_SAFE_INTEGER; state.bossHp = 1 }
    if (field === 'boss count') { state.statistics.bossesDefeated = Number.MAX_SAFE_INTEGER; state.bossHp = 1 }
    if (field === 'SPECIAL damage') state.upgradeLevels.SPECIAL_POWER = 10000
    const before = structuredClone(state)
    expect(() => executeSpecialPull(freezeDeep(state), () => 0)).toThrow(RangeError)
    expect(state).toEqual(before)
  })
  it('rejects invalid RNG in a later SPECIAL without returning partial state or rolling RNG back', () => {
    const state = freezeDeep(charged(90))
    const rng = vi.fn(sequenceRng([0, NaN]))
    expect(() => executeSpecialPulls(state, 'MAX', rng)).toThrow(RangeError)
    expect(state).toEqual(charged(90))
    expect(rng).toHaveBeenCalledTimes(2)
  })
})
