import { describe, expect, it } from 'vitest'
import { sequenceRng } from '../test/random'
import { createInitialGameState, executeNormalPull } from './engine'
import { resolveResonances } from './resonance'

describe('H2 and BOOST resonance modifiers', () => {
  it.each([0, 0.74, 0.94])('does not gain a catalyst for non-SSR roll %s', (roll) => {
    const state = createInitialGameState()
    state.catalyst = 1
    const result = executeNormalPull(state, sequenceRng([roll, 0, 0]))
    expect(result.state.catalyst).toBe(1)
    expect(result.events.some((e) => e.type === 'catalyst-gained')).toBe(false)
  })
  it.each([0, 1, 2, 3])('gains one SSR catalyst capped at 3 from %s', (catalyst) => {
    const state = createInitialGameState()
    state.catalyst = catalyst
    const result = executeNormalPull(state, sequenceRng([0.99, 0, 0]))
    expect(result.state.catalyst).toBe(Math.min(3, catalyst + 1))
    expect(result.events).toContainEqual({ type: 'catalyst-gained', stage: 1, amount: catalyst === 3 ? 0 : 1 })
    expect(state.catalyst).toBe(catalyst)
  })
  it('uses the SSR catalyst in the same pull after H1 and before resonance', () => {
    const state = createInitialGameState()
    state.stacks.WIND = 3
    const result = executeNormalPull(state, sequenceRng([0.99, 0, 0]))
    expect(result.state.catalyst).toBe(0)
    expect(result.state.stacks.FIRE).toBe(1)
    expect(result.events.map((e) => e.type)).toEqual([
      'normal-pull', 'normal-damage', 'catalyst-gained', 'resonance', 'gauge-gained', 'additional-effect',
    ])
    expect(result.events).toContainEqual({ type: 'resonance', stage: 1, resonance: 'FLAME_STORM', damage: 540, catalystConsumed: true })
  })
  it.each([0, 1, 2, 3])('consumes at most one catalyst per resonance with %s available', (catalyst) => {
    const state = createInitialGameState()
    const result = resolveResonances({ FIRE: 12, WIND: 12, THUNDER: 0 }, state.temporary, 'BALANCED', 10, 0, catalyst)
    expect(result.activations.map((e) => e.damage)).toEqual(Array.from({ length: 4 }, (_, i) => i < catalyst ? 540 : 360))
    expect(result.activations.filter((e) => e.catalystConsumed)).toHaveLength(catalyst)
    expect(result.catalyst).toBe(0)
  })
  it.each([0, 1, 2, 3])('multiplies %s BOOST with FLAME, THUNDER and catalyst and consumes BOOST once', (boostCount) => {
    const result = resolveResonances({ FIRE: 6, WIND: 6, THUNDER: 0 }, {
      boostCount, thunderStormReserved: true, flameStormPullsRemaining: 0,
    }, 'BALANCED', 10, 0, 2)
    expect(result.activations[0].damage).toBeCloseTo(240 * 1.5 * 1.4 * 1.5 * (1 + 0.25 * boostCount))
    expect(result.activations[1].damage).toBe(540)
    expect(result.temporary.boostCount).toBe(0)
    expect(result.catalyst).toBe(0)
  })
  it('preserves modifiers until a resonance occurs', () => {
    const state = createInitialGameState()
    state.temporary.boostCount = 2
    const result = resolveResonances(state.stacks, state.temporary, state.focus, 10, 0, 3)
    expect(result.catalyst).toBe(3)
    expect(result.temporary.boostCount).toBe(2)
  })
  it.each([-1, 0.5, 4, NaN, Infinity])('rejects invalid catalyst %s', (catalyst) => {
    const state = createInitialGameState()
    expect(() => resolveResonances(state.stacks, state.temporary, state.focus, 10, 0, catalyst)).toThrow(RangeError)
  })
})

describe('additional effects after resonance and before defeat', () => {
  it.each([0, 1, 2, 3])('gains BOOST after this pull resonance from %s stacks', (boostCount) => {
    const state = createInitialGameState()
    state.temporary.boostCount = boostCount
    state.stacks = { FIRE: 2, WIND: 3, THUNDER: 0 }
    const result = executeNormalPull(state, sequenceRng([0, 0, 0.98]))
    expect(result.events.find((e) => e.type === 'resonance')!.damage).toBe(360 * (1 + 0.25 * boostCount))
    expect(result.state.temporary.boostCount).toBe(1)
    expect(state.temporary.boostCount).toBe(boostCount)
  })
  it.each([0, 1, 2, 3])('caps BOOST at 3 without resonance from %s', (boostCount) => {
    const state = createInitialGameState()
    state.temporary.boostCount = boostCount
    const result = executeNormalPull(state, sequenceRng([0, 0, 0.98]))
    expect(result.state.temporary.boostCount).toBe(Math.min(3, boostCount + 1))
    expect(result.events).toContainEqual({ type: 'additional-effect', stage: 1, effect: 'BOOST', applied: true, amount: boostCount === 3 ? 0 : 1 })
  })
  it('adds CHARGE to OVERLOAD and basic gauge without auto SPECIAL', () => {
    const state = createInitialGameState()
    state.specialGauge = 29
    state.stacks = { FIRE: 2, WIND: 0, THUNDER: 3 }
    const result = executeNormalPull(state, sequenceRng([0, 0, 0.95]))
    expect(result.state.specialGauge).toBe(47)
    expect(result.events.filter((e) => e.type === 'gauge-gained').map((e) => e.source)).toEqual(['overload', 'normal', 'charge'])
    expect(result.state.statistics.totalSpecialPulls).toBe(0)
  })
  it.each([0, 0.93, 0.95, 0.98])('resets newly gained BOOST but carries catalyst, gauge and queue on defeat (roll %s)', (roll) => {
    const state = createInitialGameState()
    state.bossHp = 1
    const result = executeNormalPull(state, sequenceRng([0.99, 0, roll]))
    expect(result.state.stage).toBe(2)
    expect(result.state.catalyst).toBe(1)
    expect(result.state.temporary.boostCount).toBe(0)
    expect(result.state.specialGauge).toBe(roll === 0.95 ? 6 : 1)
    expect(result.state.pendingNormalPulls).toBe(roll === 0.93 ? 3 : 0)
    expect(result.events.at(-2)?.type).toBe('boss-defeated')
  })
  it('rejects CHARGE overflow without mutating input', () => {
    const state = createInitialGameState()
    state.specialGauge = Number.MAX_SAFE_INTEGER - 1
    const before = structuredClone(state)
    expect(() => executeNormalPull(state, sequenceRng([0, 0, 0.95]))).toThrow(RangeError)
    expect(state).toEqual(before)
  })
})
