import { describe, expect, it } from 'vitest'
import type { Focus } from '../types/game'
import { createInitialGameState } from './engine'
import { findNextResonance, resolveResonances } from './resonance'

const temporary = () => createInitialGameState().temporary

describe('resonance selection and consumption', () => {
  it.each([
    { stacks: { FIRE: 3, WIND: 3, THUNDER: 0 }, name: 'FLAME_STORM', damage: 360 },
    { stacks: { FIRE: 0, WIND: 3, THUNDER: 3 }, name: 'THUNDER_STORM', damage: 240 },
    { stacks: { FIRE: 3, WIND: 0, THUNDER: 3 }, name: 'OVERLOAD', damage: 240 },
  ])('resolves $name and consumes 3+3', ({ stacks, name, damage }) => {
    const result = resolveResonances(stacks, temporary(), 'BALANCED', 10, 0)
    expect(result.activations).toEqual([{ resonance: name, damage }])
    expect(result.stacks).toEqual({ FIRE: 0, WIND: 0, THUNDER: 0 })
    expect(stacks).not.toEqual(result.stacks)
  })
  it.each([
    ['BALANCED', 'FLAME_STORM'], ['FIRE_WIND', 'FLAME_STORM'],
    ['WIND_THUNDER', 'THUNDER_STORM'], ['THUNDER_FIRE', 'OVERLOAD'],
  ] as const)('prioritizes %s → %s', (focus, expected) => {
    expect(findNextResonance({ FIRE: 3, WIND: 3, THUNDER: 3 }, focus)).toBe(expected)
  })
  it.each([
    ['WIND_THUNDER', { FIRE: 3, WIND: 3, THUNDER: 2 }, 'FLAME_STORM'],
    ['FIRE_WIND', { FIRE: 2, WIND: 3, THUNDER: 3 }, 'THUNDER_STORM'],
    ['FIRE_WIND', { FIRE: 3, WIND: 2, THUNDER: 3 }, 'OVERLOAD'],
  ] as const)('falls back when %s pair is unavailable', (focus, stacks, expected) => {
    expect(findNextResonance(stacks, focus)).toBe(expected)
  })
  it('stops below threshold and preserves reservations until a resonance occurs', () => {
    const result = resolveResonances({ FIRE: 2, WIND: 2, THUNDER: 12 }, {
      ...temporary(), thunderStormReserved: true, flameStormPullsRemaining: 7,
    }, 'BALANCED', 10, 0)
    expect(result.activations).toEqual([])
    expect(result.temporary.thunderStormReserved).toBe(true)
    expect(result.temporary.flameStormPullsRemaining).toBe(7)
  })
  it('uses the fixed priority repeatedly and terminates at maximum stacks', () => {
    const result = resolveResonances({ FIRE: 12, WIND: 12, THUNDER: 12 }, temporary(), 'BALANCED', 10, 0)
    expect(result.activations.map((event) => event.resonance)).toEqual(Array(4).fill('FLAME_STORM'))
    expect(result.stacks).toEqual({ FIRE: 0, WIND: 0, THUNDER: 12 })
  })
  it('terminates with zero damage by consuming stacks rather than relying on damage', () => {
    expect(resolveResonances({ FIRE: 12, WIND: 12, THUNDER: 12 }, temporary(), 'BALANCED', 0, 0).activations).toHaveLength(4)
  })
})

describe('reservation and immediate effects', () => {
  it('applies THUNDER to a later FLAME in the same pull, then consumes it', () => {
    const result = resolveResonances({ FIRE: 3, WIND: 6, THUNDER: 3 }, temporary(), 'WIND_THUNDER', 10, 0)
    expect(result.activations.map((event) => event.resonance)).toEqual(['THUNDER_STORM', 'FLAME_STORM'])
    expect(result.activations[0].damage).toBe(240)
    expect(result.activations[1].damage).toBeCloseTo(504, 10)
    expect(result.temporary.thunderStormReserved).toBe(false)
    expect(result.temporary.flameStormPullsRemaining).toBe(10)
  })
  it('consumes an existing THUNDER reservation and replaces it without stacking', () => {
    const result = resolveResonances({ FIRE: 0, WIND: 6, THUNDER: 6 }, {
      ...temporary(), thunderStormReserved: true,
    }, 'BALANCED', 10, 0)
    expect(result.activations.map((event) => event.damage)).toEqual([336, 336])
    expect(result.temporary.thunderStormReserved).toBe(true)
  })
  it('does not buff the first THUNDER and buffs the next THUNDER once', () => {
    const result = resolveResonances({ FIRE: 0, WIND: 6, THUNDER: 6 }, temporary(), 'BALANCED', 10, 0)
    expect(result.activations.map((event) => event.damage)).toEqual([240, 336])
  })
  it('applies OVERLOAD +12 per activation and consumes THUNDER once', () => {
    const result = resolveResonances({ FIRE: 6, WIND: 0, THUNDER: 6 }, {
      ...temporary(), thunderStormReserved: true,
    }, 'BALANCED', 10, 0)
    expect(result.activations.map((event) => event.damage)).toEqual([336, 240])
    expect(result.gaugeGain).toBe(24)
    expect(result.temporary.thunderStormReserved).toBe(false)
  })
  it('refreshes FLAME to 10 and leaves future BOOST inert', () => {
    const inputStacks = Object.freeze({ FIRE: 3, WIND: 3, THUNDER: 0 })
    const inputTemporary = Object.freeze({ ...temporary(), flameStormPullsRemaining: 5, boostCount: 3 })
    const result = resolveResonances(inputStacks, inputTemporary, 'BALANCED', 10, 0)
    expect(result.activations[0].damage).toBe(360)
    expect(result.temporary.flameStormPullsRemaining).toBe(10)
    expect(result.temporary.boostCount).toBe(3)
    expect(inputTemporary.flameStormPullsRemaining).toBe(5)
    expect(inputStacks.FIRE).toBe(3)
  })
  it('rejects invalid stacks / focus / temporary state', () => {
    expect(() => findNextResonance({ FIRE: 13, WIND: 3, THUNDER: 3 }, 'BALANCED')).toThrow(RangeError)
    expect(() => findNextResonance({ FIRE: 3, WIND: 3, THUNDER: 3 }, 'bad' as Focus)).toThrow(RangeError)
    expect(() => resolveResonances({ FIRE: 3, WIND: 3, THUNDER: 3 }, {
      ...temporary(), flameStormPullsRemaining: 11,
    }, 'BALANCED', 10, 0)).toThrow(RangeError)
  })
})
