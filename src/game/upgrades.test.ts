import { describe, expect, it, vi } from 'vitest'
import type { GameState, Upgrade } from '../types/game'
import { calculateBossMaxHp } from './boss'
import { createInitialGameState } from './engine'
import { calculateUpgradeCost, getUpgradeInfo, purchaseUpgrade, respecUpgrades } from './upgrades'

function funded(stage = 8, shards = 1000): GameState {
  return { ...createInitialGameState(), stage, highestStage: stage, bossHp: calculateBossMaxHp(stage), resonanceShards: shards }
}
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep)
    Object.freeze(value)
  }
  return value
}
const upgrades: Upgrade[] = ['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER']
const priceCases: [Upgrade, number, number][] = [
  ['PULL_POWER', 0, 14], ['PULL_POWER', 1, 20], ['PULL_POWER', 2, 27], ['PULL_POWER', 3, 37], ['PULL_POWER', 10, 351],
  ['RESONANCE_POWER', 0, 30], ['RESONANCE_POWER', 1, 52], ['RESONANCE_POWER', 2, 89], ['RESONANCE_POWER', 3, 153], ['RESONANCE_POWER', 10, 6799],
  ['SPECIAL_POWER', 0, 40], ['SPECIAL_POWER', 1, 69], ['SPECIAL_POWER', 2, 119], ['SPECIAL_POWER', 3, 204], ['SPECIAL_POWER', 10, 9065],
  ['PULL_POWER', 105, 6814470374543778], ['RESONANCE_POWER', 61, 6988058244011854], ['SPECIAL_POWER', 60, 5417099413962678],
]

describe('upgrade prices and UI preview', () => {
  it.each(priceCases)('%s Lv%s has ceil price %s', (upgrade, level, expected) => {
    expect(calculateUpgradeCost(upgrade, level)).toBe(expected)
  })
  it.each(upgrades)('%s rejects invalid levels and excessive prices without loops', (upgrade) => {
    for (const level of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER, 10000]) {
      expect(() => calculateUpgradeCost(upgrade, level)).toThrow(RangeError)
    }
  })
  it.each([['PULL_POWER', 106], ['RESONANCE_POWER', 62], ['SPECIAL_POWER', 61]] as const)('%s has an explicit numeric boundary at Lv%s', (upgrade, level) => {
    expect(() => calculateUpgradeCost(upgrade, level)).toThrow(RangeError)
    const state = funded()
    state.upgradeLevels[upgrade] = level
    state.spentShards[upgrade] = 10_000
    expect(getUpgradeInfo(state, upgrade)).toMatchObject({ level, nextCost: null, canPurchase: false, purchaseBlockReason: 'NUMERIC_LIMIT' })
    expect(() => purchaseUpgrade(freezeDeep(state), upgrade)).toThrow(/NUMERIC_LIMIT/)
    // RESPEC remains possible without evaluating the next price.
    expect(respecUpgrades(state).resonanceShards).toBe(11_000)
  })
  it('returns detached, readonly scalar information without changing state', () => {
    const state = freezeDeep(funded(6, 30))
    const before = structuredClone(state)
    expect(getUpgradeInfo(state, 'RESONANCE_POWER')).toEqual({
      upgrade: 'RESONANCE_POWER', level: 0, nextCost: 30, unlocked: true,
      resonanceShards: 30, spentShards: 0, canPurchase: true, purchaseBlockReason: null,
    })
    expect(state).toEqual(before)
  })
  it('reports pending pulls before locked or insufficient RS; does not hide malformed state', () => {
    const state = funded(5, 0)
    state.pendingNormalPulls = state.normalPullQueue.chain = 1
    expect(getUpgradeInfo(state, 'RESONANCE_POWER')).toMatchObject({ unlocked: false, canPurchase: false, purchaseBlockReason: 'PENDING_PULLS' })
    state.pendingNormalPulls = state.normalPullQueue.chain = 0
    expect(getUpgradeInfo(state, 'RESONANCE_POWER').purchaseBlockReason).toBe('LOCKED')
    state.highestStage = 6
    expect(getUpgradeInfo(state, 'RESONANCE_POWER').purchaseBlockReason).toBe('INSUFFICIENT_RS')
    state.resonanceShards = NaN
    expect(() => getUpgradeInfo(state, 'RESONANCE_POWER')).toThrow(RangeError)
  })
})

describe('atomic manual purchases and RESPEC', () => {
  it.each([['PULL_POWER', 1, 14], ['RESONANCE_POWER', 6, 30], ['SPECIAL_POWER', 8, 40]] as const)('%s respects unlock %s and exact funds %s', (upgrade, stage, price) => {
    if (stage > 1) {
      const locked = freezeDeep(funded(stage - 1))
      expect(getUpgradeInfo(locked, upgrade).purchaseBlockReason).toBe('LOCKED')
      expect(() => purchaseUpgrade(locked, upgrade)).toThrow(/LOCKED/)
      expect(locked).toEqual(funded(stage - 1))
    }
    const short = freezeDeep(funded(stage, price - 1))
    expect(getUpgradeInfo(short, upgrade).purchaseBlockReason).toBe('INSUFFICIENT_RS')
    expect(() => purchaseUpgrade(short, upgrade)).toThrow(/INSUFFICIENT_RS/)
    const state = freezeDeep(funded(stage, price))
    const bought = purchaseUpgrade(state, upgrade)
    expect(bought.resonanceShards).toBe(0)
    expect(bought.upgradeLevels[upgrade]).toBe(1)
    expect(bought.spentShards[upgrade]).toBe(price)
    for (const other of upgrades.filter((item) => item !== upgrade)) {
      expect(bought.upgradeLevels[other]).toBe(0)
      expect(bought.spentShards[other]).toBe(0)
    }
    expect(state).toEqual(funded(stage, price))
    expect(getUpgradeInfo(funded(stage + 1, price), upgrade).canPurchase).toBe(true)
  })
  it('uses highestStage for unlocks while rejecting highestStage below stage', () => {
    expect(purchaseUpgrade({ ...funded(1), highestStage: 8 }, 'SPECIAL_POWER').upgradeLevels.SPECIAL_POWER).toBe(1)
    expect(() => purchaseUpgrade({ ...funded(8), highestStage: 7 }, 'PULL_POWER')).toThrow(RangeError)
  })
  it.each(upgrades)('%s accumulates individually rounded prices for multiple levels and fully refunds', (upgrade) => {
    const expected = upgrade === 'PULL_POWER' ? [14, 20, 27, 37] : upgrade === 'RESONANCE_POWER' ? [30, 52, 89, 153] : [40, 69, 119, 204]
    let state = freezeDeep(funded())
    let paid = 0
    for (let i = 0; i < expected.length; i++) {
      state = freezeDeep(purchaseUpgrade(state, upgrade))
      paid += expected[i]
      expect(state.upgradeLevels[upgrade]).toBe(i + 1)
      expect(state.spentShards[upgrade]).toBe(paid)
      expect(state.resonanceShards).toBe(1000 - paid)
    }
    expect(respecUpgrades(state)).toEqual(funded())
    expect(respecUpgrades(respecUpgrades(state))).toEqual(funded())
  })
  it('competes for a common RS balance without automatic allocation', () => {
    let state = purchaseUpgrade(funded(8, 84), 'PULL_POWER')
    state = purchaseUpgrade(state, 'RESONANCE_POWER')
    state = purchaseUpgrade(state, 'SPECIAL_POWER')
    expect(state.resonanceShards).toBe(0)
    expect(state.spentShards).toEqual({ PULL_POWER: 14, RESONANCE_POWER: 30, SPECIAL_POWER: 40 })
    expect(upgrades.map((upgrade) => getUpgradeInfo(state, upgrade).purchaseBlockReason)).toEqual(Array(3).fill('INSUFFICIENT_RS'))
    expect(respecUpgrades(state)).toEqual(funded(8, 84))
  })
  it('refunds the trusted ledger, never reverse-calculating prices', () => {
    const state = funded(8, 9)
    state.upgradeLevels = { PULL_POWER: 2, RESONANCE_POWER: 1, SPECIAL_POWER: 3 }
    state.spentShards = { PULL_POWER: 123, RESONANCE_POWER: 456, SPECIAL_POWER: 789 }
    const result = respecUpgrades(freezeDeep(state))
    expect(result.resonanceShards).toBe(1377)
    expect(result.upgradeLevels).toEqual(createInitialGameState().upgradeLevels)
    expect(result.spentShards).toEqual(createInitialGameState().spentShards)
    expect(respecUpgrades(result).resonanceShards).toBe(1377)
  })
  it('cannot duplicate refunds across repeated purchases and RESPEC', () => {
    let state = funded(8, 10000)
    for (let cycle = 0; cycle < 20; cycle++) {
      for (const upgrade of upgrades) state = purchaseUpgrade(freezeDeep(state), upgrade)
      state = respecUpgrades(freezeDeep(state))
      state = respecUpgrades(freezeDeep(state))
      expect(state).toEqual(funded(8, 10000))
    }
  })
  it.each(['purchase', 'respec'] as const)('%s detaches both upgrade records and shares immutable combat snapshots', (action) => {
    const state = purchaseUpgrade(funded(), 'PULL_POWER')
    const before = structuredClone(state)
    const result = action === 'purchase' ? purchaseUpgrade(freezeDeep(state), 'SPECIAL_POWER') : respecUpgrades(freezeDeep(state))
    expect(result).not.toBe(state)
    expect(result.upgradeLevels).not.toBe(state.upgradeLevels)
    expect(result.spentShards).not.toBe(state.spentShards)
    for (const key of ['stacks', 'temporary', 'jackpot', 'statistics', 'normalPullQueue'] as const) expect(result[key]).toBe(state[key])
    result.upgradeLevels.PULL_POWER = 999
    result.spentShards.PULL_POWER = 999
    expect(state).toEqual(before)
  })
  it('has no RNG dependency on success, preview, refund or rejected purchase', () => {
    const rng = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('unexpected RNG') })
    try {
      const state = purchaseUpgrade(funded(), 'PULL_POWER')
      getUpgradeInfo(state, 'SPECIAL_POWER')
      respecUpgrades(state)
      expect(() => purchaseUpgrade(funded(1, 0), 'PULL_POWER')).toThrow(RangeError)
      expect(rng).not.toHaveBeenCalled()
    } finally { rng.mockRestore() }
  })
})

describe('validation, precision and atomic failure', () => {
  const invalidNumbers = [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]
  it.each(invalidNumbers)('rejects invalid resource/level/ledger value %s in all state APIs', (invalid) => {
    for (const field of ['balance', 'level', 'ledger'] as const) {
      for (const upgrade of upgrades) {
        const state = funded()
        if (field === 'balance') state.resonanceShards = invalid
        if (field === 'level') state.upgradeLevels[upgrade] = invalid
        if (field === 'ledger') state.spentShards[upgrade] = invalid
        const before = structuredClone(state)
        expect(() => getUpgradeInfo(freezeDeep(state), 'PULL_POWER')).toThrow(RangeError)
        expect(() => purchaseUpgrade(state, 'PULL_POWER')).toThrow(RangeError)
        expect(() => respecUpgrades(state)).toThrow(RangeError)
        expect(state).toEqual(before)
      }
    }
  })
  it.each(upgrades)('%s rejects zero-level payments, missing or impossibly low payments', (upgrade) => {
    for (const [level, paid] of [[0, 1], [1, 0], [1, 1], [2, 2]]) {
      const state = funded()
      state.upgradeLevels[upgrade] = level
      state.spentShards[upgrade] = paid
      const before = structuredClone(state)
      expect(() => purchaseUpgrade(freezeDeep(state), upgrade)).toThrow(/ledger/)
      expect(() => respecUpgrades(state)).toThrow(/ledger/)
      expect(state).toEqual(before)
    }
  })
  it.each(['RESONANCE_POWER', 'SPECIAL_POWER'] as const)('rejects paid %s before unlock', (upgrade) => {
    const state = funded(1)
    state.upgradeLevels[upgrade] = 1
    state.spentShards[upgrade] = 100
    expect(() => getUpgradeInfo(state, 'PULL_POWER')).toThrow(/Locked/)
    expect(() => respecUpgrades(state)).toThrow(/Locked/)
  })
  it.each(['stage', 'highestStage'] as const)('rejects invalid %s', (field) => {
    for (const invalid of [0, ...invalidNumbers]) {
      const state = { ...funded(), [field]: invalid }
      expect(() => purchaseUpgrade(state, 'PULL_POWER')).toThrow(RangeError)
      expect(() => respecUpgrades(state)).toThrow(RangeError)
    }
  })
  it.each(['bad', '__proto__', 'toString'] as const)('rejects unknown upgrade %s', (invalid) => {
    const upgrade = invalid as Upgrade
    expect(() => calculateUpgradeCost(upgrade, 0)).toThrow(RangeError)
    expect(() => getUpgradeInfo(funded(), upgrade)).toThrow(RangeError)
    expect(() => purchaseUpgrade(funded(), upgrade)).toThrow(RangeError)
  })
  it.each(['paid sum', 'refunded balance', 'minimum paid'] as const)('rejects %s overflow atomically', (field) => {
    const state = funded(8, 0)
    state.upgradeLevels.PULL_POWER = 1
    state.spentShards.PULL_POWER = Number.MAX_SAFE_INTEGER
    if (field === 'paid sum') { state.upgradeLevels.SPECIAL_POWER = 1; state.spentShards.SPECIAL_POWER = 40 }
    if (field === 'refunded balance') state.resonanceShards = 1
    if (field === 'minimum paid') state.upgradeLevels.PULL_POWER = Number.MAX_SAFE_INTEGER
    const before = structuredClone(state)
    expect(() => getUpgradeInfo(freezeDeep(state), 'PULL_POWER')).toThrow(RangeError)
    expect(() => purchaseUpgrade(state, 'PULL_POWER')).toThrow(RangeError)
    expect(() => respecUpgrades(state)).toThrow(RangeError)
    expect(state).toEqual(before)
  })
  it('supports exactly MAX_SAFE_INTEGER refundable resources without precision loss', () => {
    const state = funded(8, Number.MAX_SAFE_INTEGER)
    const bought = purchaseUpgrade(freezeDeep(state), 'PULL_POWER')
    expect(bought.resonanceShards).toBe(Number.MAX_SAFE_INTEGER - 14)
    expect(respecUpgrades(bought).resonanceShards).toBe(Number.MAX_SAFE_INTEGER)
  })
  it('allows the last safe price, then reports numeric-limit until RESPEC', () => {
    const state = funded(8, Number.MAX_SAFE_INTEGER - 1470)
    state.upgradeLevels.PULL_POWER = 105
    state.spentShards.PULL_POWER = 1470
    const next = purchaseUpgrade(freezeDeep(state), 'PULL_POWER')
    expect(next.upgradeLevels.PULL_POWER).toBe(106)
    expect(getUpgradeInfo(next, 'PULL_POWER').purchaseBlockReason).toBe('NUMERIC_LIMIT')
    expect(respecUpgrades(next).resonanceShards).toBe(Number.MAX_SAFE_INTEGER)
  })
  it.each(['base', 'chain', 'special'] as const)('rejects purchase and RESPEC with pending %s without altering the reservation', (kind) => {
    const state = funded()
    state.specialGauge = 60
    if (kind === 'special') state.pendingSpecialPulls = 2
    else { state.normalPullQueue[kind] = 2; state.pendingNormalPulls = 2 }
    const before = structuredClone(state)
    expect(getUpgradeInfo(state, 'PULL_POWER').purchaseBlockReason).toBe('PENDING_PULLS')
    expect(() => purchaseUpgrade(freezeDeep(state), 'PULL_POWER')).toThrow(/PENDING_PULLS/)
    expect(() => respecUpgrades(state)).toThrow(/Resume/)
    expect(state).toEqual(before)
  })
  it.each(['sum mismatch', 'negative', 'both', 'unaffordable special'] as const)('rejects malformed queue: %s', (kind) => {
    const state = funded()
    if (kind === 'sum mismatch') state.normalPullQueue.base = 1
    if (kind === 'negative') state.pendingNormalPulls = -1
    if (kind === 'both') { state.pendingNormalPulls = state.normalPullQueue.chain = state.pendingSpecialPulls = 1; state.specialGauge = 30 }
    if (kind === 'unaffordable special') state.pendingSpecialPulls = 1
    expect(() => purchaseUpgrade(freezeDeep(state), 'PULL_POWER')).toThrow(RangeError)
    expect(() => respecUpgrades(state)).toThrow(RangeError)
  })
})
