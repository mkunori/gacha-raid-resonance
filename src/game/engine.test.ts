import { describe, expect, it, vi } from 'vitest'
import { seededRng, sequenceRng } from '../test/random'
import type { GameState } from '../types/game'
import { calculateBossMaxHp, calculateBossReward } from './boss'
import { createInitialGameState, executeNormalPull } from './engine'

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}

const normalRng = () => sequenceRng([0, 0, 0])
const normalDamage = (result: ReturnType<typeof executeNormalPull>) =>
  result.events.find((event) => event.type === 'normal-damage')!.damage

describe('single-pull integration', () => {
  it('creates independent initial states with all required fields', () => {
    const first = createInitialGameState()
    expect(first.stage).toBe(1)
    expect(first.bossHp).toBe(1100)
    expect(first.specialGauge).toBe(0)
    first.stacks.FIRE = 12
    expect(createInitialGameState().stacks.FIRE).toBe(0)
  })
  it('uses three draws, applies normal damage / H1 / gauge and emits ordered events', () => {
    const input = freezeDeep(createInitialGameState())
    const rng = vi.fn(normalRng())
    const result = executeNormalPull(input, rng)
    expect(rng).toHaveBeenCalledTimes(3)
    expect(result.state.bossHp).toBe(1090)
    expect(result.state.stacks).toEqual({ FIRE: 1, WIND: 0, THUNDER: 0 })
    expect(result.state.specialGauge).toBe(1)
    expect(result.state.statistics.totalNormalPulls).toBe(1)
    expect(result.events).toEqual([
      { type: 'normal-pull', stage: 1, result: { rarity: 'N', element: 'FIRE', additionalEffect: 'NONE' } },
      { type: 'normal-damage', stage: 1, damage: 10 },
      { type: 'gauge-gained', stage: 1, amount: 1, source: 'normal' },
      { type: 'additional-effect', stage: 1, effect: 'NONE', applied: false },
    ])
    expect(input).toEqual(createInitialGameState())
    // Mutating returned nested objects must not affect the caller's state.
    result.state.upgradeLevels.PULL_POWER = 1
    result.state.statistics.resonanceCounts.OVERLOAD = 1
    expect(input.upgradeLevels.PULL_POWER).toBe(0)
    expect(input.statistics.resonanceCounts.OVERLOAD).toBe(0)
  })
  it('uses upgrade levels as input without implementing purchases', () => {
    const state = createInitialGameState()
    state.upgradeLevels.PULL_POWER = 2
    state.upgradeLevels.RESONANCE_POWER = 3
    state.stacks = { FIRE: 2, WIND: 3, THUNDER: 0 }
    const result = executeNormalPull(state, normalRng())
    expect(normalDamage(result)).toBe(10 * 1.2 ** 2)
    const resonance = result.events.find((event) => event.type === 'resonance')!
    expect(resonance.damage).toBeCloseTo(10 * 1.2 ** 2 * 24 * 1.08 ** 3 * 1.5, 10)
  })
  it('applies FLAME starting next pull, for exactly 10 normal pulls', () => {
    const state = createInitialGameState()
    state.stacks = { FIRE: 2, WIND: 3, THUNDER: 0 }
    let result = executeNormalPull(state, normalRng())
    expect(normalDamage(result)).toBe(10)
    expect(result.state.temporary.flameStormPullsRemaining).toBe(10)
    for (let index = 0; index < 10; index++) {
      result = executeNormalPull(result.state, sequenceRng([0, 0.9, 0]))
      expect(normalDamage(result)).toBeCloseTo(11.5)
      expect(result.state.temporary.flameStormPullsRemaining).toBe(9 - index)
    }
    expect(normalDamage(executeNormalPull(result.state, sequenceRng([0, 0.9, 0])))).toBe(10)
  })
  it('refreshes FLAME after consuming the old buff for the current normal attack', () => {
    const state = createInitialGameState()
    state.stacks = { FIRE: 2, WIND: 3, THUNDER: 0 }
    state.temporary.flameStormPullsRemaining = 1
    const result = executeNormalPull(state, normalRng())
    expect(normalDamage(result)).toBeCloseTo(11.5)
    expect(result.state.temporary.flameStormPullsRemaining).toBe(10)
  })
  it('resolves multiple resonances before defeat even when normal damage already killed the boss', () => {
    const state = createInitialGameState()
    state.bossHp = 1
    state.focus = 'WIND_THUNDER'
    state.stacks = { FIRE: 2, WIND: 6, THUNDER: 3 }
    const result = executeNormalPull(freezeDeep(state), normalRng())
    expect(result.events.filter((event) => event.type === 'resonance').map((event) => event.resonance))
      .toEqual(['THUNDER_STORM', 'FLAME_STORM'])
    expect(result.events.map((event) => event.type)).toEqual([
      'normal-pull', 'normal-damage', 'resonance', 'resonance',
      'gauge-gained', 'additional-effect', 'boss-defeated', 'stage-started',
    ])
    expect(result.events.every((event) => event.type === 'stage-started' || event.stage === 1)).toBe(true)
    expect(result.state.stage).toBe(2)
    expect(result.state.bossHp).toBe(calculateBossMaxHp(2))
    expect(result.state.resonanceShards).toBe(18)
    expect(result.state.statistics.resonanceCounts).toEqual({ FLAME_STORM: 1, THUNDER_STORM: 1, OVERLOAD: 0 })
  })
  it.each([1, 10])('defeats exactly once at starting HP %s, resets transient state and carries persistent state', (hp) => {
    const state = createInitialGameState()
    state.bossHp = hp
    state.specialGauge = 29
    state.resonanceShards = 7
    state.catalyst = 2
    state.pendingNormalPulls = 4
    state.jackpot = { pullsInWindow: 99, ssrInWindow: 3 }
    state.temporary.boostCount = 3
    state.temporary.thunderStormReserved = true
    state.temporary.flameStormPullsRemaining = 4
    const result = executeNormalPull(state, normalRng())
    expect(result.state.stage).toBe(2)
    expect(result.state.highestStage).toBe(2)
    expect(result.state.bossHp).toBe(calculateBossMaxHp(2))
    expect(result.state.resonanceShards).toBe(25)
    expect(result.state.specialGauge).toBe(30)
    expect(result.state.catalyst).toBe(2)
    expect(result.state.pendingNormalPulls).toBe(4)
    expect(result.state.jackpot).toEqual(state.jackpot)
    expect(result.state.stacks).toEqual({ FIRE: 0, WIND: 0, THUNDER: 0 })
    expect(result.state.temporary).toEqual(createInitialGameState().temporary)
    expect(result.state.statistics.bossesDefeated).toBe(1)
    const next = executeNormalPull(result.state, normalRng())
    expect(next.state.statistics.bossesDefeated).toBe(1)
    expect(next.state.resonanceShards).toBe(25)
  })
  it('awards the defeated Stage, discards excess damage and does not end at Stage 50', () => {
    const state = createInitialGameState()
    state.stage = state.highestStage = 50
    state.bossHp = 10
    const result = executeNormalPull(state, normalRng())
    expect(result.state.stage).toBe(51)
    expect(result.state.bossHp).toBe(calculateBossMaxHp(51))
    expect(result.state.resonanceShards).toBe(calculateBossReward(50))
  })
  it.each([200, 250])('keeps OVERLOAD +12 and normal +1 when a resonance kills HP %s', (hp) => {
    const state = createInitialGameState()
    state.bossHp = hp
    state.stacks = { FIRE: 2, WIND: 0, THUNDER: 3 }
    const result = executeNormalPull(state, normalRng())
    expect(result.state.stage).toBe(2)
    expect(result.state.specialGauge).toBe(13)
    expect(result.events.filter((event) => event.type === 'gauge-gained').map((event) => event.amount)).toEqual([12, 1])
  })
  it('carries THUNDER to the next pull and consumes it exactly once', () => {
    const state = createInitialGameState()
    state.stacks = { FIRE: 0, WIND: 2, THUNDER: 3 }
    const first = executeNormalPull(state, sequenceRng([0, 0.5, 0]))
    expect(first.state.temporary.thunderStormReserved).toBe(true)
    first.state.stacks = { FIRE: 2, WIND: 3, THUNDER: 0 }
    const second = executeNormalPull(first.state, normalRng())
    expect(second.events.find((event) => event.type === 'resonance')!.damage).toBeCloseTo(504)
    expect(second.state.temporary.thunderStormReserved).toBe(false)
  })
  it('caps H1 before resonance and leaves existing CATALYST unconsumed', () => {
    const state = createInitialGameState()
    state.stacks = { FIRE: 11, WIND: 3, THUNDER: 0 }
    state.catalyst = 2
    const result = executeNormalPull(state, sequenceRng([0.995, 0, 0]))
    expect(result.state.stacks).toEqual({ FIRE: 9, WIND: 0, THUNDER: 0 })
    expect(result.events.find((event) => event.type === 'resonance')!.damage).toBe(360)
    expect(result.state.catalyst).toBe(2)
  })
  it.each([
    ['NONE', 0], ['CHAIN', 0.93], ['CHARGE', 0.95], ['BOOST', 0.98],
  ] as const)('reports %s without executing it, H2, SPECIAL or JACKPOT', (effect, roll) => {
    const state = createInitialGameState()
    state.specialGauge = 60
    state.catalyst = 2
    state.temporary.boostCount = 3
    const result = executeNormalPull(state, sequenceRng([0.995, 0, roll]))
    expect(result.events).toContainEqual({ type: 'additional-effect', stage: 1, effect, applied: false })
    expect(result.state.specialGauge).toBe(61)
    expect(result.state.catalyst).toBe(2)
    expect(result.state.temporary.boostCount).toBe(3)
    expect(result.state.pendingNormalPulls).toBe(0)
    expect(result.state.jackpot).toEqual(state.jackpot)
    expect(result.state.statistics.ssrCount).toBe(1)
    expect(result.state.statistics.totalNormalPulls).toBe(1)
    expect(result.state.statistics.totalSpecialPulls).toBe(0)
  })
  it.each([5, 10, 15, 20, 25, 35, 40, 45, 50])('leaves special boss Stage %s modifiers for Phase 5', (stage) => {
    const state = createInitialGameState()
    state.stage = state.highestStage = stage
    state.bossHp = calculateBossMaxHp(stage)
    state.stacks = { FIRE: 2, WIND: 0, THUNDER: 3 }
    const result = executeNormalPull(state, normalRng())
    expect(normalDamage(result)).toBe(10)
    expect(result.events.find((event) => event.type === 'resonance')!.damage).toBe(240)
    expect(result.state.specialGauge).toBe(13)
  })
  it('replays a fixed seed across 300 single pulls with identical states and events', () => {
    const replay = () => {
      let state = freezeDeep(createInitialGameState())
      const rng = vi.fn(seededRng(0x12345678))
      const events = []
      for (let count = 0; count < 300; count++) {
        const result = executeNormalPull(state, rng)
        state = freezeDeep(result.state)
        events.push(...result.events)
      }
      expect(rng).toHaveBeenCalledTimes(900)
      return { state, events }
    }
    expect(replay()).toEqual(replay())
  })
})

describe('engine validation / overflow', () => {
  const invalidStates: { name: string; modify: (state: GameState) => void }[] = [
    { name: 'dead HP', modify: (s) => { s.bossHp = 0 } },
    { name: 'negative HP', modify: (s) => { s.bossHp = -1 } },
    { name: 'HP above max', modify: (s) => { s.bossHp = 1101 } },
    { name: 'NaN HP', modify: (s) => { s.bossHp = NaN } },
    { name: 'infinite HP', modify: (s) => { s.bossHp = Infinity } },
    { name: 'stage zero', modify: (s) => { s.stage = 0 } },
    { name: 'fractional stage', modify: (s) => { s.stage = 1.1 } },
    { name: 'overflowing stage', modify: (s) => { s.stage = s.highestStage = 10000 } },
    { name: 'highest below stage', modify: (s) => { s.highestStage = 0 } },
    { name: 'negative gauge', modify: (s) => { s.specialGauge = -1 } },
    { name: 'unsafe gauge', modify: (s) => { s.specialGauge = Number.MAX_SAFE_INTEGER + 1 } },
    { name: 'fractional RS', modify: (s) => { s.resonanceShards = 1.1 } },
    { name: 'negative level', modify: (s) => { s.upgradeLevels.PULL_POWER = -1 } },
    { name: 'overflowing attack', modify: (s) => { s.upgradeLevels.PULL_POWER = 10000 } },
    { name: 'negative stack', modify: (s) => { s.stacks.FIRE = -1 } },
    { name: 'stack over cap', modify: (s) => { s.stacks.WIND = 13 } },
    { name: 'fractional stack', modify: (s) => { s.stacks.THUNDER = 0.1 } },
    { name: 'FLAME above duration', modify: (s) => { s.temporary.flameStormPullsRemaining = 11 } },
    { name: 'invalid reservation', modify: (s) => { s.temporary.thunderStormReserved = 1 as unknown as boolean } },
    { name: 'BOOST above cap', modify: (s) => { s.temporary.boostCount = 4 } },
    { name: 'catalyst above cap', modify: (s) => { s.catalyst = 4 } },
    { name: 'bad focus', modify: (s) => { s.focus = 'bad' as GameState['focus'] } },
    { name: 'invalid counter', modify: (s) => { s.statistics.totalNormalPulls = NaN } },
    { name: 'invalid window', modify: (s) => { s.jackpot.pullsInWindow = 100 } },
  ]
  it.each(invalidStates)('rejects $name without consuming RNG or changing state', ({ modify }) => {
    const state = createInitialGameState()
    modify(state)
    const before = structuredClone(state)
    const rng = vi.fn(normalRng())
    expect(() => executeNormalPull(state, rng)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
    expect(state).toEqual(before)
  })
  it.each(['gauge', 'RS', 'normal count', 'boss count', 'resonance count'] as const)(
    'rejects %s overflow atomically',
    (field) => {
      const state = createInitialGameState()
      if (field === 'gauge') state.specialGauge = Number.MAX_SAFE_INTEGER
      if (field === 'RS') { state.resonanceShards = Number.MAX_SAFE_INTEGER; state.bossHp = 1 }
      if (field === 'normal count') state.statistics.totalNormalPulls = Number.MAX_SAFE_INTEGER
      if (field === 'boss count') { state.statistics.bossesDefeated = Number.MAX_SAFE_INTEGER; state.bossHp = 1 }
      if (field === 'resonance count') {
        state.statistics.resonanceCounts.FLAME_STORM = Number.MAX_SAFE_INTEGER
        state.stacks = { FIRE: 2, WIND: 3, THUNDER: 0 }
      }
      const before = structuredClone(state)
      expect(() => executeNormalPull(freezeDeep(state), normalRng())).toThrow(RangeError)
      expect(state).toEqual(before)
    },
  )
  it('rejects invalid RNG without changing the input state', () => {
    const state = freezeDeep(createInitialGameState())
    expect(() => executeNormalPull(state, () => NaN)).toThrow(RangeError)
    expect(state).toEqual(createInitialGameState())
  })
  it('accepts the last safe integer gauge increment without a gameplay cap', () => {
    const state = createInitialGameState()
    state.specialGauge = Number.MAX_SAFE_INTEGER - 1
    expect(executeNormalPull(state, normalRng()).state.specialGauge).toBe(Number.MAX_SAFE_INTEGER)
  })
})
