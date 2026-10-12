import { describe, expect, it, vi } from 'vitest'
import { sequenceRng, seededRng } from '../test/random'
import type { Element, Focus, NormalPullResult, Rarity } from '../types/game'
import { applyNormalPullStacks, drawNormalPull } from './gacha'

// Adjacent representable doubles, rather than an arbitrary epsilon.
function adjacent(value: number, direction: 1 | -1): number {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  view.setBigUint64(0, view.getBigUint64(0) + BigInt(direction))
  return view.getFloat64(0)
}

interface DistributionCase {
  label: string
  field: keyof NormalPullResult
  focus: Focus
  rngIndex: number
  outcomes: readonly string[]
  thresholds: readonly number[]
}

// Independent expectations taken from v0.6; not generated from production data.
const distributions: DistributionCase[] = [
  { label: 'rarity', field: 'rarity', focus: 'BALANCED', rngIndex: 0,
    outcomes: ['N', 'R', 'SR', 'SSR'], thresholds: [0.74, 0.94, 0.99] },
  { label: 'BALANCED', field: 'element', focus: 'BALANCED', rngIndex: 1,
    outcomes: ['FIRE', 'WIND', 'THUNDER'], thresholds: [0.34, 0.67] },
  { label: 'FIRE_WIND', field: 'element', focus: 'FIRE_WIND', rngIndex: 1,
    outcomes: ['FIRE', 'WIND', 'THUNDER'], thresholds: [0.45, 0.90] },
  { label: 'WIND_THUNDER', field: 'element', focus: 'WIND_THUNDER', rngIndex: 1,
    outcomes: ['FIRE', 'WIND', 'THUNDER'], thresholds: [0.10, 0.55] },
  { label: 'THUNDER_FIRE', field: 'element', focus: 'THUNDER_FIRE', rngIndex: 1,
    outcomes: ['FIRE', 'WIND', 'THUNDER'], thresholds: [0.45, 0.55] },
  { label: 'additional effect', field: 'additionalEffect', focus: 'BALANCED', rngIndex: 2,
    outcomes: ['NONE', 'CHAIN', 'CHARGE', 'BOOST'], thresholds: [0.92, 0.94, 0.97] },
]

describe.each(distributions)('$label intervals', ({ field, focus, rngIndex, outcomes, thresholds }) => {
  const cases = [
    { label: 'zero', roll: 0, expected: outcomes[0] },
    { label: 'largest value below one', roll: adjacent(1, -1), expected: outcomes.at(-1) },
    ...thresholds.flatMap((threshold, index) => [
      { label: 'immediately below ' + threshold, roll: adjacent(threshold, -1), expected: outcomes[index] },
      { label: 'exactly ' + threshold, roll: threshold, expected: outcomes[index + 1] },
      { label: 'immediately above ' + threshold, roll: adjacent(threshold, 1), expected: outcomes[index + 1] },
    ]),
  ]
  it.each(cases)('$label → $expected', ({ roll, expected }) => {
    const values = [0, 0, 0]
    values[rngIndex] = roll
    expect(drawNormalPull(focus, sequenceRng(values))[field]).toBe(expected)
  })
})

describe('independent draws and RNG contract', () => {
  const rarities = [
    { roll: 0, rarity: 'N' }, { roll: 0.8, rarity: 'R' },
    { roll: 0.96, rarity: 'SR' }, { roll: 0.995, rarity: 'SSR' },
  ] as const
  const elements = [
    { roll: 0, element: 'FIRE' }, { roll: 0.5, element: 'WIND' }, { roll: 0.8, element: 'THUNDER' },
  ] as const
  const effects = [
    { roll: 0, effect: 'NONE' }, { roll: 0.93, effect: 'CHAIN' },
    { roll: 0.95, effect: 'CHARGE' }, { roll: 0.98, effect: 'BOOST' },
  ] as const
  const combinations = rarities.flatMap((rarity) =>
    elements.flatMap((element) => effects.map((effect) => ({ rarity, element, effect }))),
  )

  it.each(combinations)('draws $rarity.rarity / $element.element / $effect.effect independently', ({ rarity, element, effect }) => {
    const rng = vi.fn(sequenceRng([rarity.roll, element.roll, effect.roll]))
    expect(drawNormalPull('BALANCED', rng)).toEqual({
      rarity: rarity.rarity, element: element.element, additionalEffect: effect.effect,
    })
    expect(rng).toHaveBeenCalledTimes(3)
  })

  it('changes only element probabilities when focus changes', () => {
    const expected = [
      ['BALANCED', 'FIRE'], ['FIRE_WIND', 'FIRE'],
      ['WIND_THUNDER', 'WIND'], ['THUNDER_FIRE', 'FIRE'],
    ] as const
    for (const [focus, element] of expected) {
      expect(drawNormalPull(focus, sequenceRng([0.995, 0.2, 0.93]))).toEqual({
        rarity: 'SSR', element, additionalEffect: 'CHAIN',
      })
    }
  })

  it('replays the same fixed sequence without extra draws across pulls', () => {
    const values = Object.freeze([0.74, 0.67, 0.94, 0.99, 0.34, 0.92])
    const run = () => {
      const rng = vi.fn(sequenceRng(values))
      const results = [drawNormalPull('BALANCED', rng), drawNormalPull('BALANCED', rng)]
      expect(rng).toHaveBeenCalledTimes(6)
      return results
    }
    const expected = [
      { rarity: 'R', element: 'THUNDER', additionalEffect: 'CHARGE' },
      { rarity: 'SSR', element: 'WIND', additionalEffect: 'CHAIN' },
    ]
    expect(run()).toEqual(expected)
    expect(run()).toEqual(expected)
  })

  it.each(['BALANCED', 'FIRE_WIND', 'WIND_THUNDER', 'THUNDER_FIRE'] as const)(
    'reproduces 100 pulls with Mulberry32 seed 0x12345678, focus %s',
    (focus) => {
      const replay = () => {
        const rng = vi.fn(seededRng(0x12345678))
        const results = Array.from({ length: 100 }, () => drawNormalPull(focus, rng))
        expect(rng).toHaveBeenCalledTimes(300)
        return results
      }
      expect(replay()).toEqual(replay())
    },
  )

  it.each(['UNKNOWN', 'toString', '__proto__'] as unknown as Focus[])('rejects invalid focus %s before consuming RNG', (focus) => {
    const rng = vi.fn(() => 0)
    expect(() => drawNormalPull(focus, rng)).toThrow(RangeError)
    expect(rng).not.toHaveBeenCalled()
  })

  const invalidRolls = [NaN, -Infinity, Infinity, -Number.MIN_VALUE, -1, 1, 2, undefined, null, '0.5'] as unknown as number[]
  it.each(invalidRolls.flatMap((roll) => [0, 1, 2].map((index) => ({ roll, index }))))(
    'rejects roll $roll at RNG position $index without retry',
    ({ roll, index }) => {
      const values = [0, 0, 0]
      values[index] = roll
      const rng = vi.fn(sequenceRng(values))
      expect(() => drawNormalPull('BALANCED', rng)).toThrow(RangeError)
      expect(rng).toHaveBeenCalledTimes(index + 1)
    },
  )
})

describe('H1 stacks', () => {
  const elements: Element[] = ['FIRE', 'WIND', 'THUNDER']
  const rarities: { rarity: Rarity; increment: number }[] = [
    { rarity: 'N', increment: 1 }, { rarity: 'R', increment: 1 },
    { rarity: 'SR', increment: 2 }, { rarity: 'SSR', increment: 4 },
  ]
  const cases = elements.flatMap((element) => rarities.map((rarity) => ({ element, ...rarity })))

  it.each(cases)('adds $increment for $rarity to $element without mutation', ({ element, rarity, increment }) => {
    const stacks = Object.freeze({ FIRE: 1, WIND: 2, THUNDER: 3 })
    const result = Object.freeze({ element, rarity })
    const next = applyNormalPullStacks(stacks, result)
    expect(next).toEqual({ ...stacks, [element]: stacks[element] + increment })
    expect(next).not.toBe(stacks)
    expect(stacks).toEqual({ FIRE: 1, WIND: 2, THUNDER: 3 })
    expect(result).toEqual({ element, rarity })
  })

  it.each(cases)('caps $rarity accumulation on $element at 12', ({ element, rarity }) => {
    for (const count of [0, 10, 11, 12]) {
      const stacks = Object.freeze({ FIRE: 12, WIND: 12, THUNDER: 12, [element]: count })
      expect(applyNormalPullStacks(stacks, { element, rarity })).toEqual({
        ...stacks, [element]: Math.min(12, count + rarities.find((entry) => entry.rarity === rarity)!.increment),
      })
    }
  })

  const invalidCounts = [-1, 13, 0.5, NaN, Infinity, -Infinity, undefined]
  it.each(elements.flatMap((element) => invalidCounts.map((count) => ({ element, count }))))(
    'rejects invalid $element stack $count even when a different element is drawn',
    ({ element, count }) => {
      const stacks = { FIRE: 0, WIND: 0, THUNDER: 0, [element]: count } as Record<Element, number>
      const before = { ...stacks }
      const drawnElement = element === 'FIRE' ? 'WIND' : 'FIRE'
      expect(() => applyNormalPullStacks(stacks, { element: drawnElement, rarity: 'N' })).toThrow(RangeError)
      expect(stacks).toEqual(before)
    },
  )

  it.each([
    { element: 'UNKNOWN', rarity: 'N' }, { element: 'FIRE', rarity: 'UNKNOWN' },
    { element: 'FIRE', rarity: 'toString' }, { element: 'FIRE', rarity: '__proto__' },
  ])('rejects invalid result $element / $rarity', (result) => {
    expect(() => applyNormalPullStacks(
      { FIRE: 0, WIND: 0, THUNDER: 0 },
      result as Pick<NormalPullResult, 'element' | 'rarity'>,
    )).toThrow(RangeError)
  })

  it('does not apply additional effects or consume resonance stacks', () => {
    const result: NormalPullResult = { element: 'FIRE', rarity: 'SSR', additionalEffect: 'CHAIN' }
    expect(applyNormalPullStacks({ FIRE: 3, WIND: 3, THUNDER: 3 }, result)).toEqual({
      FIRE: 7, WIND: 3, THUNDER: 3,
    })
  })
})
