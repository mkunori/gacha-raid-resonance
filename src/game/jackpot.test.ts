import { describe, expect, it, vi } from 'vitest'
import { seededRng, sequenceRng } from '../test/random'
import type { GameState, Rarity } from '../types/game'
import { calculateBossMaxHp, calculateBossReward } from './boss'
import { createInitialGameState, executeNormalPull, executeNormalPulls, executeSpecialPull, resumePendingNormalPulls } from './engine'
import { resolveJackpot } from './jackpot'

function atStage(stage: number): GameState {
  return { ...createInitialGameState(), stage, highestStage: stage, bossHp: calculateBossMaxHp(stage) }
}
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

describe('pure JACKPOT window', () => {
  it.each([1, 19])('does not count even SSR before Stage 20 (Stage %s)', (stage) => {
    const window = Object.freeze({ pullsInWindow: 0, ssrInWindow: 0 })
    const result = resolveJackpot(window, stage, 'SSR', 10)
    expect(result.window).toEqual(window)
    expect(result.completed).toBe(false)
    expect(result.triggered).toBe(false)
    expect(result.damage).toBe(0)
    expect(result.gaugeGain).toBe(0)
  })
  it.each(['N', 'R', 'SR', 'SSR'] as const)('counts %s exactly once from Stage 20', (rarity) => {
    const input = Object.freeze({ pullsInWindow: 0, ssrInWindow: 0 })
    const result = resolveJackpot(input, 20, rarity, 10)
    expect(result.window).toEqual({ pullsInWindow: 1, ssrInWindow: rarity === 'SSR' ? 1 : 0 })
    expect(result.completed).toBe(false)
    expect(input.pullsInWindow).toBe(0)
  })
  it.each([0, 1, 2, 3, 4, 99])('finishes the hundredth pull with %s SSR and resets both counters', (ssrCount) => {
    const input = Object.freeze({ pullsInWindow: 99, ssrInWindow: ssrCount })
    const result = resolveJackpot(input, 20, 'N', 10)
    expect(result.completed).toBe(true)
    expect(result.ssrCount).toBe(ssrCount)
    expect(result.triggered).toBe(ssrCount >= 3)
    expect(result.damage).toBe(ssrCount >= 3 ? 1800 : 0)
    expect(result.gaugeGain).toBe(ssrCount >= 3 ? 30 : 0)
    expect(result.window).toEqual({ pullsInWindow: 0, ssrInWindow: 0 })
    expect(input.pullsInWindow).toBe(99)
  })
  it('includes the hundredth SSR and starts a fresh next window', () => {
    const result = resolveJackpot({ pullsInWindow: 99, ssrInWindow: 2 }, 20, 'SSR', 12.345)
    expect(result.ssrCount).toBe(3)
    expect(result.damage).toBe(12.345 * 180)
    expect(result.triggered).toBe(true)
    const next = resolveJackpot(result.window, 21, 'SSR', 10)
    expect(next.window).toEqual({ pullsInWindow: 1, ssrInWindow: 1 })
    expect(next.completed).toBe(false)
  })
  it.each([
    { pullsInWindow: -1, ssrInWindow: 0 }, { pullsInWindow: 100, ssrInWindow: 0 },
    { pullsInWindow: 1.5, ssrInWindow: 0 }, { pullsInWindow: NaN, ssrInWindow: 0 },
    { pullsInWindow: 1, ssrInWindow: -1 }, { pullsInWindow: 1, ssrInWindow: 2 },
    { pullsInWindow: 1, ssrInWindow: 0.5 }, { pullsInWindow: 1, ssrInWindow: Infinity },
  ])('rejects invalid window $pullsInWindow/$ssrInWindow', (window) => {
    expect(() => resolveJackpot(window, 20, 'N', 10)).toThrow(RangeError)
  })
  it('rejects stale counters before unlock instead of silently importing them', () => {
    expect(() => resolveJackpot({ pullsInWindow: 1, ssrInWindow: 0 }, 19, 'N', 10)).toThrow(RangeError)
  })
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid Stage %s', (stage) => {
    expect(() => resolveJackpot({ pullsInWindow: 0, ssrInWindow: 0 }, stage, 'N', 10)).toThrow(RangeError)
  })
  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid attack %s', (attack) => {
    expect(() => resolveJackpot({ pullsInWindow: 0, ssrInWindow: 0 }, 20, 'N', attack)).toThrow(RangeError)
  })
  it('rejects unknown rarity and overflowing JACKPOT damage', () => {
    expect(() => resolveJackpot({ pullsInWindow: 0, ssrInWindow: 0 }, 20, 'bad' as Rarity, 10)).toThrow(RangeError)
    expect(() => resolveJackpot({ pullsInWindow: 99, ssrInWindow: 3 }, 20, 'N', Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
  })
})

describe('JACKPOT integration and original Stage ordering', () => {
  it('excludes the Stage19 killing SSR and counts the first Stage20 NORMAL pull', () => {
    const state = atStage(19)
    state.bossHp = 1
    const first = executeNormalPull(freezeDeep(state), sequenceRng([0.99, 0, 0]))
    expect(first.state.stage).toBe(20)
    expect(first.state.jackpot).toEqual({ pullsInWindow: 0, ssrInWindow: 0 })
    const second = executeNormalPull(first.state, sequenceRng([0.99, 0, 0]))
    expect(second.state.jackpot).toEqual({ pullsInWindow: 1, ssrInWindow: 1 })
    expect(first.events.some((e) => e.type === 'jackpot-window')).toBe(false)
  })
  it('includes a CHAIN child on Stage20 when the root killed Stage19', () => {
    const state = atStage(19)
    state.bossHp = 1
    const result = executeNormalPulls(state, 1, sequenceRng([0.99, 0, 0.93, ...Array(9).fill(0)]))
    expect(result.summary.actualPulls).toBe(4)
    expect(result.state.jackpot).toEqual({ pullsInWindow: 3, ssrInWindow: 0 })
  })
  it.each([1, 1000, 1810])('applies JACKPOT to old boss HP %s once, after effects and before defeat', (hp) => {
    const state = atStage(20)
    state.bossHp = hp
    state.jackpot = { pullsInWindow: 99, ssrInWindow: 3 }
    const input = structuredClone(state)
    const result = executeNormalPull(freezeDeep(state), sequenceRng([0, 0, 0.95]))
    expect(result.state.stage).toBe(21)
    expect(result.state.bossHp).toBe(calculateBossMaxHp(21))
    expect(result.state.resonanceShards).toBe(calculateBossReward(20))
    expect(result.state.specialGauge).toBe(36)
    expect(result.state.statistics.jackpotCount).toBe(1)
    expect(result.state.statistics.bossesDefeated).toBe(1)
    expect(result.state.jackpot).toEqual({ pullsInWindow: 0, ssrInWindow: 0 })
    expect(result.events.map((e) => e.type)).toEqual([
      'normal-pull', 'normal-damage', 'gauge-gained', 'gauge-gained', 'additional-effect',
      'jackpot-window', 'gauge-gained', 'boss-defeated', 'stage-started',
    ])
    expect(result.events).toContainEqual({ type: 'jackpot-window', stage: 20, ssrCount: 3, triggered: true, damage: 1800, gaugeGain: 30 })
    expect(result.events.filter((e) => e.type !== 'stage-started').every((e) => e.stage === 20)).toBe(true)
    expect(state).toEqual(input)
  })
  it('emits a missed window, resets its counters and awards no jackpot gauge or damage', () => {
    const state = atStage(20)
    state.jackpot = { pullsInWindow: 99, ssrInWindow: 2 }
    const result = executeNormalPull(state, sequenceRng([0, 0, 0]))
    expect(result.events).toContainEqual({ type: 'jackpot-window', stage: 20, ssrCount: 2, triggered: false, damage: 0, gaugeGain: 0 })
    expect(result.state.statistics.jackpotCount).toBe(0)
    expect(result.state.bossHp).toBe(state.bossHp - 17)
    expect(result.state.specialGauge).toBe(1)
    expect(result.state.jackpot).toEqual({ pullsInWindow: 0, ssrInWindow: 0 })
  })
  it.each([0.93, 0.98])('preserves H2/resonance order and then applies effect %s and JACKPOT before resetting the boss', (effectRoll) => {
    const state = atStage(20)
    state.bossHp = 1500
    state.focus = 'WIND_THUNDER'
    state.stacks = { FIRE: 0, WIND: 6, THUNDER: 3 }
    state.temporary.boostCount = 2
    state.temporary.thunderStormReserved = true
    state.jackpot = { pullsInWindow: 99, ssrInWindow: 2 }
    const result = executeNormalPull(freezeDeep(state), sequenceRng([0.99, 0, effectRoll]))
    const resonances = result.events.filter((e) => e.type === 'resonance')
    expect(resonances.map((e) => e.resonance)).toEqual(['THUNDER_STORM', 'FLAME_STORM'])
    expect(resonances[0].damage).toBeCloseTo(240 * 1.4 * 1.5 * 1.5 * 0.7)
    expect(resonances[0].catalystConsumed).toBe(true)
    expect(resonances[0].boostConsumed).toBe(2)
    expect(resonances[1].damage).toBeCloseTo(240 * 1.4 * 1.5 * 0.7)
    expect(resonances[1].catalystConsumed).toBeUndefined()
    expect(result.state.stage).toBe(21)
    expect(result.state.catalyst).toBe(0)
    expect(result.state.pendingNormalPulls).toBe(effectRoll === 0.93 ? 3 : 0)
    expect(result.state.temporary).toEqual(createInitialGameState().temporary)
    expect(result.state.statistics.jackpotCount).toBe(1)
    expect(result.state.statistics.bossesDefeated).toBe(1)
    const order = result.events.map((e) => e.type)
    expect(order.indexOf('additional-effect')).toBeLessThan(order.indexOf('jackpot-window'))
    expect(order.indexOf('jackpot-window')).toBeLessThan(order.indexOf('boss-defeated'))
  })
  it('uses current A alone, independent of SPECIAL/RESONANCE POWER and temporary buffs', () => {
    const state = atStage(20)
    state.upgradeLevels = { PULL_POWER: 2, RESONANCE_POWER: 5, SPECIAL_POWER: 5 }
    state.temporary = { boostCount: 3, thunderStormReserved: true, flameStormPullsRemaining: 10 }
    state.catalyst = 3
    state.jackpot = { pullsInWindow: 99, ssrInWindow: 3 }
    const result = executeNormalPull(state, sequenceRng([0, 0, 0]))
    expect(result.events.find((e) => e.type === 'jackpot-window')!.damage).toBe(10 * 1.2 ** 2 * 180)
    expect(result.state.temporary.boostCount).toBe(3)
    expect(result.state.catalyst).toBe(3)
    expect(result.state.statistics.totalSpecialPulls).toBe(0)
  })
  it('preserves a partial window through NORMAL defeat and intervening SPECIAL defeat', () => {
    const state = atStage(20)
    state.specialGauge = 30
    state.bossHp = 1
    state.jackpot = { pullsInWindow: 50, ssrInWindow: 2 }
    const normal = executeNormalPull(state, sequenceRng([0, 0, 0]))
    expect(normal.state.jackpot).toEqual({ pullsInWindow: 51, ssrInWindow: 2 })
    const special = executeSpecialPull({ ...normal.state, bossHp: 1 }, () => 0)
    expect(special.state.stage).toBe(22)
    expect(special.state.jackpot).toEqual(normal.state.jackpot)
  })
  it('counts CHAIN draws in the same 100-pull window and aggregates one JACKPOT', () => {
    const state = atStage(20)
    state.jackpot = { pullsInWindow: 96, ssrInWindow: 2 }
    const rng = vi.fn(sequenceRng([0.99, 0, 0.93, ...Array(9).fill(0)]))
    const result = executeNormalPulls(state, 1, rng)
    expect(result.state.jackpot).toEqual({ pullsInWindow: 0, ssrInWindow: 0 })
    expect(result.summary.actualPulls).toBe(4)
    expect(result.summary.chainAdded).toBe(3)
    expect(result.summary.jackpotCount).toBe(1)
    expect(result.state.statistics.jackpotCount).toBe(1)
    expect(result.state.specialGauge).toBe(34)
    expect(rng).toHaveBeenCalledTimes(12)
  })
  it('checks multiple hundred-pull windows in one batch and exposes no unbounded event history', () => {
    let draws = 0
    const rng = () => ++draws % 3 === 1 ? 0.99 : 0
    const state = atStage(51)
    const result = executeNormalPulls(state, 1000, rng)
    expect(result.summary.actualPulls).toBe(1000)
    expect(result.summary.ssrCount).toBe(1000)
    expect(result.summary.jackpotCount).toBe(10)
    expect(result.state.statistics.jackpotCount).toBe(10)
    expect(result.state.specialGauge).toBe(1300)
    expect(result.state.jackpot).toEqual({ pullsInWindow: 0, ssrInWindow: 0 })
    expect(draws).toBe(3000)
    expect('events' in result).toBe(false)
  })
  it.each([1, 10, 100])('matches single actions, batching and resumed chunks of %s on seed 42 across Stage19/20', (limit) => {
    const initial = atStage(19)
    initial.bossHp = 1
    const wholeRng = vi.fn(seededRng(42))
    const whole = executeNormalPulls(initial, 100, wholeRng)
    const singleRng = vi.fn(seededRng(42))
    let single = initial
    for (let i = 0; i < 100; i++) single = executeNormalPulls(single, 1, singleRng).state
    expect(single).toEqual(whole.state)
    const chunkRng = vi.fn(seededRng(42))
    let chunk = executeNormalPulls(freezeDeep(initial), 100, chunkRng, limit)
    const sum = { ...chunk.summary, effectCounts: { ...chunk.summary.effectCounts }, resonanceCounts: { ...chunk.summary.resonanceCounts } }
    while (chunk.state.pendingNormalPulls > 0) {
      const saved: GameState = JSON.parse(JSON.stringify(chunk.state))
      chunk = resumePendingNormalPulls(freezeDeep(saved), chunkRng, limit)
      for (const key of ['actualPulls', 'chainAdded', 'stagesAdvanced', 'earnedShards', 'ssrCount', 'jackpotCount'] as const) sum[key] += chunk.summary[key]
      for (const key of ['NONE', 'CHAIN', 'CHARGE', 'BOOST'] as const) sum.effectCounts[key] += chunk.summary.effectCounts[key]
      for (const key of ['FLAME_STORM', 'THUNDER_STORM', 'OVERLOAD'] as const) sum.resonanceCounts[key] += chunk.summary.resonanceCounts[key]
      sum.pendingPulls = chunk.summary.pendingPulls
    }
    expect(chunk.state).toEqual(whole.state)
    expect(sum).toEqual(whole.summary)
    expect(chunkRng.mock.calls.length).toBe(whole.summary.actualPulls * 3)
    expect(singleRng.mock.calls.length).toBe(chunkRng.mock.calls.length)
    expect(chunkRng()).toBe(wholeRng())
  })
  it('rejects stale pre-Stage20 window in the engine before RNG', () => {
    const state = atStage(19)
    state.jackpot = { pullsInWindow: 1, ssrInWindow: 0 }
    const rng = vi.fn(() => 0)
    expect(() => executeNormalPull(state, rng)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
  })
  it.each(['gauge', 'jackpot count', 'damage'] as const)('rejects jackpot %s overflow without mutating input', (field) => {
    const state = atStage(20)
    state.jackpot = { pullsInWindow: 99, ssrInWindow: 3 }
    if (field === 'gauge') state.specialGauge = Number.MAX_SAFE_INTEGER - 1
    if (field === 'jackpot count') state.statistics.jackpotCount = Number.MAX_SAFE_INTEGER
    // Normal damage remains safe but the independent JACKPOT channel overflows.
    if (field === 'damage') state.upgradeLevels.PULL_POWER = 161
    const before = structuredClone(state)
    expect(() => executeNormalPull(freezeDeep(state), sequenceRng([0, 0, 0]))).toThrow(RangeError)
    expect(state).toEqual(before)
  })
})
