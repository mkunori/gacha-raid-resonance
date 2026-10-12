import { describe, expect, it, vi } from 'vitest'
import { seededRng, sequenceRng } from '../test/random'
import type { GameState, Upgrade } from '../types/game'
import { calculateBossMaxHp, calculateBossReward } from './boss'
import {
  createInitialGameState, executeNormalPull, executeNormalPulls, executeSpecialPull,
  executeSpecialPulls, resumePendingNormalPulls, resumePendingSpecialPulls,
} from './engine'
import { getUpgradeInfo, purchaseUpgrade, respecUpgrades } from './upgrades'

function funded(stage = 40): GameState {
  return { ...createInitialGameState(), stage, highestStage: stage, bossHp: calculateBossMaxHp(stage), resonanceShards: 10_000, specialGauge: 300 }
}

/** Independent runs from the same combat snapshot; no mutations between channels. */
function damages(state: GameState) {
  const normal = executeNormalPull(state, sequenceRng([0, 0, 0]))
  const resonance = executeNormalPull({ ...state, stacks: { FIRE: 2, WIND: 3, THUNDER: 0 } }, sequenceRng([0, 0, 0]))
  const special = executeSpecialPull(state, () => 0)
  const jackpot = executeNormalPull({ ...state, jackpot: { pullsInWindow: 99, ssrInWindow: 3 } }, sequenceRng([0, 0, 0]))
  return {
    normal: normal.events.find((e) => e.type === 'normal-damage')!.damage,
    resonance: resonance.events.find((e) => e.type === 'resonance')!.damage,
    special: special.events.find((e) => e.type === 'special-damage')!.damage,
    jackpot: jackpot.events.find((e) => e.type === 'jackpot-window')!.damage,
  }
}

describe('purchased levels in the existing battle engine', () => {
  it.each(['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER'] as const)('%s changes only its intended damage channels and RESPEC restores them', (upgrade) => {
    const initial = funded()
    initial.catalyst = 2
    initial.temporary = { boostCount: 2, thunderStormReserved: true, flameStormPullsRemaining: 10 }
    const original = structuredClone(initial)
    const baseline = damages(initial)
    // Stage40: FIRE normal .5*1.7, FLAME .7; JACKPOT has no boss factor.
    expect(baseline.normal).toBeCloseTo(10 * 1.15 * 0.5 * 1.7)
    expect(baseline.resonance).toBeCloseTo(240 * 1.5 * 1.4 * 1.5 * 1.5 * 0.7)
    expect(baseline.special).toBe(200)
    expect(baseline.jackpot).toBe(1800)
    let upgraded = purchaseUpgrade(initial, upgrade)
    upgraded = purchaseUpgrade(upgraded, upgrade)
    const actual = damages(upgraded)
    const factor = upgrade === 'PULL_POWER' ? 1.2 ** 2 : upgrade === 'RESONANCE_POWER' ? 1.08 ** 2 : 1.1 ** 2
    for (const channel of ['normal', 'resonance', 'special', 'jackpot'] as const) {
      const affected = upgrade === 'PULL_POWER' || (upgrade === 'RESONANCE_POWER' && channel === 'resonance') || (upgrade === 'SPECIAL_POWER' && channel === 'special')
      expect(actual[channel]).toBeCloseTo(baseline[channel] * (affected ? factor : 1))
    }
    expect(damages(respecUpgrades(upgraded))).toEqual(baseline)
    expect(initial).toEqual(original)
    expect(respecUpgrades(upgraded)).toEqual(initial)
  })
  it('applies a purchased SPECIAL level with the Stage35 boss multiplier', () => {
    const state = purchaseUpgrade(funded(35), 'SPECIAL_POWER')
    expect(executeSpecialPull(state, () => 0.95).events.find((e) => e.type === 'special-damage')!.damage).toBeCloseTo(10 * 100 * 1.1 * 1.8)
    expect(executeSpecialPull(respecUpgrades(state), () => 0.95).events.find((e) => e.type === 'special-damage')!.damage).toBe(1800)
  })
  it.each([[5, 'RESONANCE_POWER'], [7, 'SPECIAL_POWER']] as const)('permits %s defeat to unlock %s purchase with its actual reward', (stage, upgrade) => {
    const state = { ...funded(stage), bossHp: 1, resonanceShards: 0 }
    expect(getUpgradeInfo(state, upgrade).unlocked).toBe(false)
    const after = executeNormalPull(state, () => 0).state
    expect(after.stage).toBe(stage + 1)
    expect(after.resonanceShards).toBe(calculateBossReward(stage))
    const info = getUpgradeInfo(after, upgrade)
    expect(info.canPurchase).toBe(true)
    const bought = purchaseUpgrade(after, upgrade)
    expect(bought.resonanceShards).toBe(calculateBossReward(stage) - info.nextCost!)
    expect(bought.upgradeLevels[upgrade]).toBe(1)
  })
  it('preserves earned combat RS, resources, buffs and statistics through RESPEC', () => {
    const initial = funded(40)
    let state = initial
    for (const upgrade of ['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER'] as const) state = purchaseUpgrade(state, upgrade)
    state = executeNormalPull({ ...state, bossHp: 1 }, sequenceRng([0.99, 0, 0.95])).state
    const before = structuredClone(state)
    const result = respecUpgrades(state)
    expect(result).toEqual({ ...before, resonanceShards: 10_000 + calculateBossReward(40),
      upgradeLevels: initial.upgradeLevels, spentShards: initial.spentShards })
    expect(result.catalyst).toBe(1)
    expect(result.specialGauge).toBe(306)
    expect(result.statistics.totalNormalPulls).toBe(1)
    expect(result.statistics.ssrCount).toBe(1)
    expect(state).toEqual(before)
    expect(respecUpgrades(result)).toEqual(result)
  })
  it('keeps a battle-acquired FLAME buff and resonance statistics after RESPEC', () => {
    const purchased = purchaseUpgrade(funded(), 'RESONANCE_POWER')
    const state = executeNormalPull({ ...purchased, stacks: { FIRE: 2, WIND: 3, THUNDER: 0 } }, () => 0).state
    const before = structuredClone(state)
    expect(state.temporary.flameStormPullsRemaining).toBe(10)
    const result = respecUpgrades(state)
    expect(result).toEqual({ ...before, resonanceShards: 10_000,
      upgradeLevels: createInitialGameState().upgradeLevels, spentShards: createInitialGameState().spentShards })
    expect(result.statistics.resonanceCounts.FLAME_STORM).toBe(1)
    expect(result.specialGauge).toBe(301)
    expect(result.temporary.flameStormPullsRemaining).toBe(10)
  })
  it.each(['normal', 'special'] as const)('refuses mid-%s upgrades and preserves seeded split/whole equivalence until completion', (kind) => {
    const initial = purchaseUpgrade(funded(50), 'PULL_POWER')
    const fullRng = vi.fn(seededRng(42))
    const rng = vi.fn(seededRng(42))
    if (kind === 'normal') {
      const full = executeNormalPulls(initial, 1000, fullRng)
      let chunk = executeNormalPulls(initial, 1000, rng, 7)
      const before = structuredClone(chunk.state)
      const calls = rng.mock.calls.length
      expect(() => purchaseUpgrade(chunk.state, 'SPECIAL_POWER')).toThrow(/PENDING_PULLS/)
      expect(() => respecUpgrades(chunk.state)).toThrow(/Resume/)
      expect(rng).toHaveBeenCalledTimes(calls)
      expect(chunk.state).toEqual(before)
      while (chunk.state.pendingNormalPulls) chunk = resumePendingNormalPulls(JSON.parse(JSON.stringify(chunk.state)), rng, 7)
      expect(chunk.state).toEqual(full.state)
      expect(purchaseUpgrade(chunk.state, 'SPECIAL_POWER').upgradeLevels.SPECIAL_POWER).toBe(1)
      expect(respecUpgrades(chunk.state).upgradeLevels.PULL_POWER).toBe(0)
    } else {
      const full = executeSpecialPulls(initial, 'MAX', fullRng)
      let chunk = executeSpecialPulls(initial, 'MAX', rng, 3)
      const before = structuredClone(chunk.state)
      const calls = rng.mock.calls.length
      expect(() => purchaseUpgrade(chunk.state, 'SPECIAL_POWER')).toThrow(/PENDING_PULLS/)
      expect(() => respecUpgrades(chunk.state)).toThrow(/Resume/)
      expect(rng).toHaveBeenCalledTimes(calls)
      expect(chunk.state).toEqual(before)
      while (chunk.state.pendingSpecialPulls) chunk = resumePendingSpecialPulls(JSON.parse(JSON.stringify(chunk.state)), rng, 3)
      expect(chunk.state).toEqual(full.state)
      expect(purchaseUpgrade(chunk.state, 'SPECIAL_POWER').upgradeLevels.SPECIAL_POWER).toBe(1)
      expect(respecUpgrades(chunk.state).upgradeLevels.PULL_POWER).toBe(0)
    }
    expect(rng.mock.calls.length).toBe(fullRng.mock.calls.length)
    expect(rng()).toBe(fullRng())
  })
  it('keeps CHAIN pending until all descendants finish before permitting purchase', () => {
    const rng = sequenceRng([0, 0, 0.93, ...Array(9).fill(0)])
    const paused = executeNormalPulls(funded(), 1, rng, 1).state
    expect(paused.normalPullQueue).toEqual({ base: 0, chain: 3 })
    expect(() => purchaseUpgrade(paused, 'PULL_POWER')).toThrow(/PENDING_PULLS/)
    expect(() => respecUpgrades(paused)).toThrow(/Resume/)
    const completed = resumePendingNormalPulls(paused, rng).state
    expect(purchaseUpgrade(completed, 'PULL_POWER').upgradeLevels.PULL_POWER).toBe(1)
  })
  it('replays purchase, seeded combat and RESPEC deterministically', () => {
    const run = () => {
      let state = funded(50)
      const rng = seededRng(0x12345678)
      for (let step = 0; step < 3; step++) {
        for (const upgrade of ['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER'] as Upgrade[]) state = purchaseUpgrade(state, upgrade)
        state = executeNormalPulls(state, 100, rng).state
        state = executeSpecialPulls(state, 1, rng).state
        state = respecUpgrades(state)
      }
      return { state, nextRandom: rng() }
    }
    expect(run()).toEqual(run())
  })
})
