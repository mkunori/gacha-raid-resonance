import { describe, expect, it, vi } from 'vitest'
import { CORE_RULES } from '../data/rules'
import { seededRng, sequenceRng } from '../test/random'
import type { GameState, NormalPullCount } from '../types/game'
import { createInitialGameState, executeNormalPull, executeNormalPulls, resumePendingNormalPulls } from './engine'

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

describe('NORMAL PULL actions and CHAIN queue', () => {
  it.each([1, 10, 100, 1000] as const)('executes x%s without CHAIN, three RNG calls per pull', (count) => {
    const rng = vi.fn(() => 0)
    const input = freezeDeep(createInitialGameState())
    const result = executeNormalPulls(input, count, rng)
    expect(result.summary.actualPulls).toBe(count)
    expect(result.summary.effectCounts.NONE).toBe(count)
    expect(result.summary.pendingPulls).toBe(0)
    expect(result.state.normalPullQueue).toEqual({ base: 0, chain: 0 })
    expect(result.state.statistics.totalNormalPulls).toBe(count)
    expect(rng).toHaveBeenCalledTimes(count * 3)
    expect(input).toEqual(createInitialGameState())
  })
  it('rechains with ordinary draws, drains all descendants and carries them across defeat', () => {
    const input = createInitialGameState()
    input.bossHp = 1
    // Root -> CHAIN, first child -> CHAIN, five remaining children -> NONE.
    const rng = vi.fn(sequenceRng([0, 0, 0.93, 0.99, 0, 0.93, ...Array(15).fill(0)]))
    const result = executeNormalPulls(input, 1, rng)
    expect(result.summary).toEqual({
      actualPulls: 7, chainAdded: 6, pendingPulls: 0, stagesAdvanced: 1, earnedShards: 18, ssrCount: 1,
      resonanceCounts: { FLAME_STORM: 0, THUNDER_STORM: 0, OVERLOAD: 0 },
      effectCounts: { NONE: 5, CHAIN: 2, CHARGE: 0, BOOST: 0 },
    })
    expect(result.state.stage).toBe(2)
    expect(result.state.catalyst).toBe(1)
    expect(rng).toHaveBeenCalledTimes(21)
  })
  it('keeps remaining base pulls untouched until the FIFO CHAIN group is drained', () => {
    const rng = sequenceRng([0, 0, 0.93, 0, 0, 0.93, ...Array(15).fill(0)])
    let result = executeNormalPulls(createInitialGameState(), 10, rng, 1)
    expect(result.state.normalPullQueue).toEqual({ base: 9, chain: 3 })
    result = resumePendingNormalPulls(result.state, rng, 1)
    expect(result.state.normalPullQueue).toEqual({ base: 9, chain: 5 })
    result = resumePendingNormalPulls(result.state, rng, 5)
    expect(result.state.normalPullQueue).toEqual({ base: 9, chain: 0 })
    expect(result.state.pendingNormalPulls).toBe(9)
  })
  it.each([1, 10, 100, 1000] as const)('matches %s consecutive x1 actions with CHAIN on seed 0x12345678', (count) => {
    const initial = createInitialGameState()
    const batched = executeNormalPulls(initial, count, seededRng(0x12345678))
    const rng = seededRng(0x12345678)
    let state = initial
    let actualPulls = 0
    let chainAdded = 0
    for (let i = 0; i < count; i++) {
      const result = executeNormalPulls(state, 1, rng)
      state = result.state
      actualPulls += result.summary.actualPulls
      chainAdded += result.summary.chainAdded
    }
    expect(state).toEqual(batched.state)
    expect(actualPulls).toBe(batched.summary.actualPulls)
    expect(chainAdded).toBe(batched.summary.chainAdded)
  })
  it('matches atomic single-step replay and event aggregates', () => {
    const batch = executeNormalPulls(createInitialGameState(), 100, seededRng(123))
    let state = createInitialGameState()
    state.normalPullQueue.base = state.pendingNormalPulls = 100
    const rng = seededRng(123)
    const effects = { NONE: 0, CHAIN: 0, CHARGE: 0, BOOST: 0 }
    const resonances = { FLAME_STORM: 0, THUNDER_STORM: 0, OVERLOAD: 0 }
    while (state.pendingNormalPulls > 0) {
      const step = executeNormalPull(freezeDeep(state), rng)
      state = step.state
      for (const event of step.events) {
        if (event.type === 'additional-effect') effects[event.effect]++
        if (event.type === 'resonance') resonances[event.resonance]++
      }
    }
    expect(state).toEqual(batch.state)
    expect(effects).toEqual(batch.summary.effectCounts)
    expect(resonances).toEqual(batch.summary.resonanceCounts)
  })
  it.each([1, 7, 100])('resumes chunks of %s with JSON-roundtripped state and the same RNG continuation', (limit) => {
    const full = executeNormalPulls(createInitialGameState(), 1000, seededRng(42))
    const rng = seededRng(42)
    let chunk = executeNormalPulls(freezeDeep(createInitialGameState()), 1000, rng, limit)
    let actual = chunk.summary.actualPulls
    let chain = chunk.summary.chainAdded
    let rs = chunk.summary.earnedShards
    let ssr = chunk.summary.ssrCount
    let stages = chunk.summary.stagesAdvanced
    const effects = { ...chunk.summary.effectCounts }
    const resonances = { ...chunk.summary.resonanceCounts }
    while (chunk.state.pendingNormalPulls > 0) {
      const saved: GameState = JSON.parse(JSON.stringify(chunk.state))
      chunk = resumePendingNormalPulls(freezeDeep(saved), rng, limit)
      actual += chunk.summary.actualPulls
      chain += chunk.summary.chainAdded
      rs += chunk.summary.earnedShards
      ssr += chunk.summary.ssrCount
      stages += chunk.summary.stagesAdvanced
      for (const effect of ['NONE', 'CHAIN', 'CHARGE', 'BOOST'] as const) effects[effect] += chunk.summary.effectCounts[effect]
      for (const resonance of ['FLAME_STORM', 'THUNDER_STORM', 'OVERLOAD'] as const) resonances[resonance] += chunk.summary.resonanceCounts[resonance]
    }
    expect(chunk.state).toEqual(full.state)
    expect(actual).toBe(full.summary.actualPulls)
    expect(chain).toBe(full.summary.chainAdded)
    expect(rs).toBe(full.summary.earnedShards)
    expect(ssr).toBe(full.summary.ssrCount)
    expect(stages).toBe(full.summary.stagesAdvanced)
    expect(effects).toEqual(full.summary.effectCounts)
    expect(resonances).toEqual(full.summary.resonanceCounts)
  })
  it('crosses multiple bosses and reports the exact RS and stage differences', () => {
    const result = executeNormalPulls(createInitialGameState(), 1000, seededRng(22))
    expect(result.summary.stagesAdvanced).toBeGreaterThan(1)
    expect(result.summary.stagesAdvanced).toBe(result.state.stage - 1)
    expect(result.summary.earnedShards).toBe(result.state.resonanceShards)
    expect(result.summary.ssrCount).toBe(result.state.statistics.ssrCount)
  })
  it('stops at exactly 100,000 actual pulls with adversarial CHAIN, bounded output and resumable state', () => {
    let draws = 0
    const rng = () => ++draws % 3 === 0 ? 0.93 : 0
    const input = freezeDeep(createInitialGameState())
    const result = executeNormalPulls(input, 1000, rng)
    expect(result.summary.actualPulls).toBe(CORE_RULES.operationPullLimit)
    expect(draws).toBe(300_000)
    expect(result.summary.chainAdded).toBe(300_000)
    expect(result.state.normalPullQueue).toEqual({ base: 999, chain: 200_001 })
    expect(result.state.pendingNormalPulls).toBe(201_000)
    expect(JSON.stringify(result.summary).length).toBeLessThan(500)
    expect('events' in result).toBe(false)
    const next = resumePendingNormalPulls(freezeDeep(result.state), () => 0, 1)
    expect(next.state.normalPullQueue).toEqual({ base: 999, chain: 200_000 })
    expect(result.state.pendingNormalPulls).toBe(201_000)
    expect(input).toEqual(createInitialGameState())
  })
  it('stops at a completed PULL, including its defeat, CHARGE and reward', () => {
    const state = createInitialGameState()
    state.bossHp = 1
    const result = executeNormalPulls(state, 10, sequenceRng([0, 0, 0.95]), 1)
    expect(result.state.stage).toBe(2)
    expect(result.state.specialGauge).toBe(6)
    expect(result.state.resonanceShards).toBe(18)
    expect(result.state.normalPullQueue).toEqual({ base: 9, chain: 0 })
  })
  it('returns an immutable snapshot with zero work and no RNG calls for an empty resume', () => {
    const state = freezeDeep(createInitialGameState())
    const rng = vi.fn(() => 0)
    const result = resumePendingNormalPulls(state, rng)
    expect(result.state).toBe(state)
    expect(result.summary.actualPulls).toBe(0)
    expect(rng).not.toHaveBeenCalled()
  })
})

describe('queue validation and atomic failure', () => {
  it.each([0, 2, 11, -1, 1.5, NaN, Infinity])('rejects unsupported action count %s before RNG', (count) => {
    const rng = vi.fn(() => 0)
    expect(() => executeNormalPulls(createInitialGameState(), count as NormalPullCount, rng)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
  })
  it.each([0, -1, 0.5, 100_001, NaN, Infinity])('rejects invalid limit %s before RNG for start and resume', (limit) => {
    const rng = vi.fn(() => 0)
    expect(() => executeNormalPulls(createInitialGameState(), 1, rng, limit)).toThrow(RangeError)
    expect(() => resumePendingNormalPulls(createInitialGameState(), rng, limit)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
  })
  it.each([
    { base: -1, chain: 1, pending: 0 }, { base: 0.5, chain: 0, pending: 0.5 },
    { base: 0, chain: -1, pending: -1 }, { base: 0, chain: NaN, pending: NaN },
    { base: 1, chain: 2, pending: 1 }, { base: Number.MAX_SAFE_INTEGER, chain: 1, pending: Number.MAX_SAFE_INTEGER },
  ])('rejects inconsistent or invalid queue $base/$chain/$pending', ({ base, chain, pending }) => {
    const state = createInitialGameState()
    state.normalPullQueue = { base, chain }
    state.pendingNormalPulls = pending
    const rng = vi.fn(() => 0)
    expect(() => resumePendingNormalPulls(freezeDeep(state), rng)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
  })
  it('rejects a new batch action while pending without consuming RNG', () => {
    const paused = executeNormalPulls(createInitialGameState(), 10, () => 0, 1).state
    const before = structuredClone(paused)
    const rng = vi.fn(() => 0)
    expect(() => executeNormalPulls(freezeDeep(paused), 1, rng)).toThrow(/Resume/)
    expect(rng).not.toHaveBeenCalled()
    expect(paused).toEqual(before)
  })
  it('rejects queue overflow after CHAIN without modifying the input', () => {
    const state = createInitialGameState()
    state.normalPullQueue = { base: Number.MAX_SAFE_INTEGER - 1, chain: 1 }
    state.pendingNormalPulls = Number.MAX_SAFE_INTEGER
    const before = structuredClone(state)
    expect(() => resumePendingNormalPulls(freezeDeep(state), sequenceRng([0, 0, 0.93]), 1)).toThrow(RangeError)
    expect(state).toEqual(before)
  })
  it('does not expose partially processed state when a later pull fails; RNG is not rolled back', () => {
    const state = freezeDeep(createInitialGameState())
    const rng = vi.fn(sequenceRng([0, 0, 0, NaN]))
    expect(() => executeNormalPulls(state, 10, rng)).toThrow(RangeError)
    expect(state).toEqual(createInitialGameState())
    expect(rng).toHaveBeenCalledTimes(4)
  })
})
