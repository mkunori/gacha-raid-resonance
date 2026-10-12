import { describe, expect, it } from 'vitest'
import { applyBossDamage, calculateBossMaxHp, calculateBossReward, finishBossDefeat } from './boss'
import { calculateAttack, calculateNormalDamage, calculateResonanceDamage } from './combat'
import { createInitialGameState } from './engine'

describe('v0.6 boss and damage formulas', () => {
  it.each(Array.from({ length: 50 }, (_, index) => index + 1))('uses the specified HP / reward formula at Stage %i', (stage) => {
    expect(calculateBossMaxHp(stage)).toBe(Math.ceil(1100 * 1.36 ** (stage - 1)))
    expect(calculateBossReward(stage)).toBe(Math.ceil(18 * 1.36 ** (stage - 1)))
  })
  it('starts at HP 1100 / reward 18 / attack 10 and scales attack without rounding', () => {
    expect(calculateBossMaxHp(1)).toBe(1100)
    expect(calculateBossReward(1)).toBe(18)
    expect(calculateAttack(0)).toBe(10)
    expect(calculateAttack(3)).toBe(10 * 1.2 ** 3)
    expect(calculateResonanceDamage(calculateAttack(2), 3)).toBe(10 * 1.2 ** 2 * 24 * 1.08 ** 3)
  })
  it.each([['N', 10], ['R', 20], ['SR', 50], ['SSR', 120]] as const)('calculates %s normal damage', (rarity, damage) => {
    expect(calculateNormalDamage(10, rarity)).toBe(damage)
    expect(calculateNormalDamage(10, rarity, true)).toBeCloseTo(damage * 1.15, 12)
  })
  it('multiplies channel-specific modifiers without integer rounding', () => {
    expect(calculateNormalDamage(10, 'N', true, 0.75)).toBeCloseTo(8.625)
    expect(calculateResonanceDamage(10, 0, 1.5 * 1.4, 0.7)).toBeCloseTo(352.8)
    expect(applyBossDamage(10.5, 0.25)).toBe(10.25)
    expect(applyBossDamage(10, 10)).toBe(0)
    expect(applyBossDamage(10, 20)).toBe(-10)
  })
  it('allows zero damage and zero multipliers', () => {
    expect(calculateNormalDamage(0, 'SSR')).toBe(0)
    expect(calculateResonanceDamage(10, 0, 0)).toBe(0)
    expect(applyBossDamage(10, 0)).toBe(10)
  })
  it('does not award a living boss and awards a dead boss only in the returned state', () => {
    const state = createInitialGameState()
    expect(finishBossDefeat(state)).toEqual({ state, events: [] })
    const dead = { ...state, bossHp: -1 }
    const result = finishBossDefeat(dead)
    expect(result.state.resonanceShards).toBe(18)
    expect(result.state.statistics.bossesDefeated).toBe(1)
    expect(finishBossDefeat(result.state).events).toEqual([])
    expect(dead.resonanceShards).toBe(0)
  })
})

describe('numeric guards', () => {
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 10000])('rejects unsupported Stage %s', (stage) => {
    expect(() => calculateBossMaxHp(stage)).toThrow(RangeError)
    expect(() => calculateBossReward(stage)).toThrow(RangeError)
  })
  it.each([-1, 0.1, NaN, Infinity, 10000])('rejects invalid / overflowing level %s', (level) => {
    expect(() => calculateAttack(level)).toThrow(RangeError)
    expect(() => calculateResonanceDamage(10, level)).toThrow(RangeError)
  })
  it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid attack / damage / modifier %s', (value) => {
    expect(() => calculateNormalDamage(value, 'N')).toThrow(RangeError)
    expect(() => calculateResonanceDamage(value, 0)).toThrow(RangeError)
    expect(() => calculateNormalDamage(10, 'N', false, value)).toThrow(RangeError)
    expect(() => calculateResonanceDamage(10, 0, value)).toThrow(RangeError)
    expect(() => applyBossDamage(10, value)).toThrow(RangeError)
  })
  it('rejects multiplication and subtraction overflow', () => {
    expect(() => calculateNormalDamage(Number.MAX_SAFE_INTEGER, 'SSR')).toThrow(RangeError)
    expect(() => calculateResonanceDamage(Number.MAX_SAFE_INTEGER, 0)).toThrow(RangeError)
    expect(() => applyBossDamage(-Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError)
  })
})
