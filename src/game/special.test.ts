import { describe, expect, it, vi } from 'vitest'
import { seededRng, sequenceRng } from '../test/random'
import type { SpecialResult } from '../types/game'
import { calculateSpecialDamage, calculateSpecialMaxCount, drawSpecialPull } from './special'

describe('independent SPECIAL draw', () => {
  it.each([
    [0, 'STRIKE'], [0.75 - Number.EPSILON, 'STRIKE'], [0.75, 'BURST'],
    [0.75 + Number.EPSILON, 'BURST'], [0.95 - Number.EPSILON, 'BURST'],
    [0.95, 'MEGA_BURST'], [0.95 + Number.EPSILON, 'MEGA_BURST'], [1 - Number.EPSILON, 'MEGA_BURST'],
  ] as const)('draws roll %s as %s with exactly one RNG call', (roll, expected) => {
    const rng = vi.fn(() => roll)
    expect(drawSpecialPull(rng)).toBe(expected)
    expect(rng).toHaveBeenCalledTimes(1)
  })
  it.each([-Number.EPSILON, -1, 1, 1 + Number.EPSILON, NaN, Infinity, -Infinity])('rejects RNG %s without retry', (roll) => {
    const rng = vi.fn(() => roll)
    expect(() => drawSpecialPull(rng)).toThrow(RangeError)
    expect(rng).toHaveBeenCalledTimes(1)
  })
  it('replays a fixed column and seed independently of NORMAL', () => {
    const rng = sequenceRng([0.95, 0, 0.75])
    expect(Array.from({ length: 3 }, () => drawSpecialPull(rng))).toEqual(['MEGA_BURST', 'STRIKE', 'BURST'])
    const replay = () => {
      const rng = seededRng(42)
      return Array.from({ length: 100 }, () => drawSpecialPull(rng))
    }
    expect(replay()).toEqual(replay())
    expect(new Set(replay()).size).toBe(3)
  })
})

describe('SPECIAL damage and fixed MAX count', () => {
  it.each([
    ['STRIKE', 20], ['BURST', 40], ['MEGA_BURST', 100],
  ] as const)('uses %s channel multiplier %s and independent SPECIAL POWER', (result, multiplier) => {
    const attack = 10 * 1.2 ** 3
    const damage = calculateSpecialDamage(attack, result, 2)
    expect(damage).toBeCloseTo(attack * multiplier * 1.1 ** 2, 10)
    expect(damage).not.toBe(Math.ceil(damage))
    expect(calculateSpecialDamage(attack, result, 2, 1.8)).toBeCloseTo(damage * 1.8, 10)
    expect(calculateSpecialDamage(0, result, 0)).toBe(0)
  })
  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid attack %s', (attack) => {
    expect(() => calculateSpecialDamage(attack, 'STRIKE', 0)).toThrow(RangeError)
  })
  it.each([-1, 0.5, NaN, Infinity, 10000])('rejects invalid/overflowing SPECIAL level %s', (level) => {
    expect(() => calculateSpecialDamage(10, 'STRIKE', level)).toThrow(RangeError)
  })
  it.each([-1, NaN, Infinity])('rejects invalid SPECIAL boss multiplier %s', (multiplier) => {
    expect(() => calculateSpecialDamage(10, 'STRIKE', 0, multiplier)).toThrow(RangeError)
  })
  it('rejects unknown results and overflowing damage', () => {
    expect(() => calculateSpecialDamage(10, 'bad' as SpecialResult, 0)).toThrow(RangeError)
    expect(() => calculateSpecialDamage(Number.MAX_SAFE_INTEGER, 'STRIKE', 0)).toThrow(RangeError)
  })
  it.each([[0, 0], [29, 0], [30, 1], [59, 1], [60, 2], [91, 3]] as const)('reserves floor(%s/30) = %s', (gauge, expected) => {
    expect(calculateSpecialMaxCount(gauge)).toBe(expected)
  })
  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid gauge %s', (gauge) => {
    expect(() => calculateSpecialMaxCount(gauge)).toThrow(RangeError)
  })
})
