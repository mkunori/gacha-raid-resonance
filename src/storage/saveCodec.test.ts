import { describe, expect, it } from 'vitest'
import { calculateBossMaxHp } from '../game/boss'
import { createInitialGameState, executeNormalPull, executeNormalPulls, executeSpecialPulls,
  resumePendingNormalPulls, resumePendingSpecialPulls } from '../game/engine'
import { setFocus } from '../game/progression'
import { calculateUpgradeCost, getUpgradeInfo, purchaseUpgrade, respecUpgrades } from '../game/upgrades'
import type { GameState, SaveDataV1, Upgrade } from '../types/game'
import { createCheckpointRandom } from './random'
import { deserializeSaveData, MAX_SAVE_JSON_LENGTH, SaveDataError, serializeSaveData, validateSaveData } from './saveCodec'

function initial(): SaveDataV1 {
  return { saveVersion: 1, state: createInitialGameState(), settings: { reducedEffects: false },
    rng: { algorithm: 'mulberry32-v1', state: 0x12345678 } }
}

function roundTrip(save: SaveDataV1): SaveDataV1 {
  const result = deserializeSaveData(serializeSaveData(save))
  expect(result).toEqual(save)
  return result
}

function expectCode(action: () => unknown, code: SaveDataError['code']) {
  try { action() } catch (error) {
    expect(error).toBeInstanceOf(SaveDataError)
    expect((error as SaveDataError).code).toBe(code)
    expect((error as Error).message).toMatch(/[ぁ-龯]/u)
    return
  }
  throw new Error('Expected save rejection')
}

// All schema paths: missing/wrong keys must fail at every nesting depth.
function paths(value: unknown, prefix: string[] = []): string[][] {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => [[...prefix, key], ...paths(child, [...prefix, key])])
}
function parent(save: SaveDataV1, path: string[]): Record<string, unknown> {
  let value: unknown = save
  for (const key of path.slice(0, -1)) value = (value as Record<string, unknown>)[key]
  return value as Record<string, unknown>
}

describe('v1 fixed schema and error contract', () => {
  it('round-trips the initial state and reducedEffects', () => {
    roundTrip(initial())
    const save = initial()
    save.settings.reducedEffects = true
    roundTrip(save)
  })

  it.each(paths(initial()))('rejects missing key %j', (...path: string[]) => {
    const save = initial()
    delete parent(save, path)[path.at(-1)!]
    expectCode(() => validateSaveData(save), 'SCHEMA')
  })

  it.each(paths(initial()))('rejects null at %j', (...path: string[]) => {
    const save = initial()
    parent(save, path)[path.at(-1)!] = null
    expectCode(() => validateSaveData(save), 'SCHEMA')
  })

  it.each([null, 0, true, [], '', {}, { saveVersion: '1' }])('rejects invalid root %j', value => {
    expectCode(() => validateSaveData(value), 'SCHEMA')
  })

  it.each([0, 2, 100])('explicitly refuses unsupported version %s', version => {
    expectCode(() => deserializeSaveData(JSON.stringify({ ...initial(), saveVersion: version })), 'VERSION')
  })

  it.each(['', '{', '{"saveVersion":1,}', 'undefined'])('rejects broken JSON %j', json => {
    expectCode(() => deserializeSaveData(json), 'SYNTAX')
  })

  it('checks the code-unit limit before parsing and accepts exactly the limit', () => {
    expectCode(() => deserializeSaveData(' '.repeat(MAX_SAVE_JSON_LENGTH + 1)), 'SIZE')
    const json = serializeSaveData(initial())
    expect(deserializeSaveData(json.padEnd(MAX_SAVE_JSON_LENGTH))).toEqual(initial())
  })

  it.each(['state', 'settings', 'rng', 'state.stacks', 'state.statistics', 'state.statistics.resonanceCounts'])('rejects extra keys inside %s', name => {
    const save = initial()
    const path = name.split('.')
    const object = parent(save, [...path, 'extra'])
    object.extra = 1
    expectCode(() => validateSaveData(save), 'SCHEMA')
  })

  it('rejects prototype pollution keys, symbols, accessors, hidden keys and non-JSON objects', () => {
    const json = serializeSaveData(initial())
    expectCode(() => deserializeSaveData(json.replace('"saveVersion":1', '"saveVersion":1,"__proto__":{"polluted":true}')), 'SCHEMA')
    const save = initial()
    Object.defineProperty(save.settings, 'hidden', { value: true })
    expectCode(() => validateSaveData(save), 'SCHEMA')
    const symbolSave = initial()
    Object.defineProperty(symbolSave.rng, Symbol('hidden'), { value: 1 })
    expectCode(() => validateSaveData(symbolSave), 'SCHEMA')
    const accessor = initial()
    Object.defineProperty(accessor.settings, 'reducedEffects', { get: () => { throw new Error('must not execute getter') }, enumerable: true })
    expectCode(() => validateSaveData(accessor), 'SCHEMA')
    expectCode(() => validateSaveData(new Date()), 'SCHEMA')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it.each(['123', true, [], {}])('refuses coercion of numeric resources from %j', value => {
    const save = initial()
    parent(save, ['state', 'specialGauge']).specialGauge = value
    expectCode(() => validateSaveData(save), 'SCHEMA')
  })

  it.each([0, 1, 'true', [], {}])('requires actual booleans, not %j', value => {
    const save = initial()
    parent(save, ['settings', 'reducedEffects']).reducedEffects = value
    expectCode(() => validateSaveData(save), 'SCHEMA')
  })

  it('returns an independent copy of every nested object without modifying frozen input', () => {
    const save = initial()
    function freeze(value: object) {
      Object.values(value).forEach(child => { if (child && typeof child === 'object') freeze(child) })
      Object.freeze(value)
    }
    freeze(save)
    const copy = validateSaveData(save)
    for (const path of paths(save)) {
      const key = path.at(-1)!
      const value = parent(save, path)[key]
      if (typeof value === 'object') expect(parent(copy, path)[key]).not.toBe(value)
    }
    copy.state.stacks.FIRE = 1
    copy.settings.reducedEffects = true
    expect(save.state.stacks.FIRE).toBe(0)
    expect(save.settings.reducedEffects).toBe(false)
  })
})

const invalidStates: [string, (save: SaveDataV1) => void][] = [
  ['HP zero', s => { s.state.bossHp = 0 }],
  ['HP above maximum', s => { s.state.bossHp++ }],
  ['stage overflow', s => { s.state.stage = s.state.highestStage = 10000 }],
  ['highest below stage', s => { s.state.highestStage = 0 }],
  ['highest HP overflow', s => { s.state.highestStage = 10000 }],
  ['stack cap', s => { s.state.stacks.FIRE = 13 }],
  ['catalyst cap', s => { s.state.catalyst = 4 }],
  ['boost cap', s => { s.state.temporary.boostCount = 4 }],
  ['flame duration', s => { s.state.temporary.flameStormPullsRemaining = 11 }],
  ['focus unknown', s => { s.state.focus = 'INVALID' as GameState['focus'] }],
  ['focus locked', s => { s.state.focus = 'FIRE_WIND' }],
  ['queue sum', s => { s.state.pendingNormalPulls = 1 }],
  ['queue overflow', s => { s.state.normalPullQueue = { base: Number.MAX_SAFE_INTEGER, chain: 1 } }],
  ['special gauge shortage', s => { s.state.pendingSpecialPulls = 1 }],
  ['simultaneous queues', s => { s.state.specialGauge = 30; s.state.pendingSpecialPulls = 1; s.state.pendingNormalPulls = 1; s.state.normalPullQueue.base = 1 }],
  ['window 100', s => { s.state.jackpot.pullsInWindow = 100 }],
  ['SSR larger than window', s => { s.state.jackpot.ssrInWindow = 1 }],
  ['window before Stage20', s => { s.state.jackpot.pullsInWindow = 1 }],
  ['lifetime SSR above pulls', s => { s.state.statistics.ssrCount = 1 }],
  ['catalyst without SSR', s => { s.state.catalyst = 1 }],
  ['jackpot without interval', s => { s.state.statistics.jackpotCount = 1 }],
  ['boss defeats without pulls', s => { s.state.statistics.bossesDefeated = 1 }],
  ['stage without defeats', s => { s.state.highestStage = 2 }],
  ['resonances without pulls', s => { s.state.statistics.resonanceCounts.OVERLOAD = 1 }],
  ['unknown RNG', s => { s.rng.algorithm = 'unknown' as 'mulberry32-v1' }],
  ['RNG overflow', s => { s.rng.state = 0x100000000 }],
]

describe('semantic validation', () => {
  it.each(invalidStates)('rejects %s without mutation', (_, mutate) => {
    const save = initial()
    mutate(save)
    const before = structuredClone(save)
    expectCode(() => validateSaveData(save), 'STATE')
    expect(save).toEqual(before)
    expectCode(() => serializeSaveData(save), 'STATE')
  })

  const numericPaths = paths(initial()).filter(path => typeof parent(initial(), path)[path.at(-1)!] === 'number'
    && path.join('.') !== 'saveVersion')
  it.each(numericPaths)('rejects dangerous numbers at %j', (...path: string[]) => {
    for (const value of [NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const save = initial()
      parent(save, path)[path.at(-1)!] = value
      expectCode(() => validateSaveData(save), 'STATE')
    }
    if (path.join('.') !== 'state.bossHp') {
      const save = initial()
      parent(save, path)[path.at(-1)!] = 0.5
      expectCode(() => validateSaveData(save), 'STATE')
    }
  })

  it('rejects NaN serialized to null rather than converting it to zero', () => {
    const save = initial()
    save.state.resonanceShards = NaN
    expectCode(() => deserializeSaveData(JSON.stringify(save)), 'SCHEMA')
  })

  it('preserves fractional and exponent-form HP and allows safe gauge/RS maxima', () => {
    const save = initial()
    save.state.bossHp = 1.234567890123456e-7
    save.state.specialGauge = Number.MAX_SAFE_INTEGER
    save.state.resonanceShards = Number.MAX_SAFE_INTEGER
    roundTrip(save)
  })

  it.each([0, 0xffffffff])('accepts RNG endpoint %s', state => {
    roundTrip({ ...initial(), rng: { algorithm: 'mulberry32-v1', state } })
  })

  it('rejects overlapping JACKPOT history and the current partial interval', () => {
    const save = initial()
    save.state.stage = save.state.highestStage = 20
    save.state.bossHp = calculateBossMaxHp(20)
    Object.assign(save.state.statistics, { totalNormalPulls: 100, ssrCount: 4, bossesDefeated: 19, jackpotCount: 1 })
    save.state.jackpot = { pullsInWindow: 1, ssrInWindow: 1 }
    expectCode(() => validateSaveData(save), 'STATE')
    save.state.statistics.totalNormalPulls = 101
    roundTrip(save)
    save.state.statistics.ssrCount = 3
    expectCode(() => validateSaveData(save), 'STATE')
  })

  it.each([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER - 2])('keeps the resonance statistics bound exact at %s pulls', total => {
    const save = initial()
    save.state.statistics.totalNormalPulls = total
    const maximum = Number(BigInt(total) * 4n / 6n)
    save.state.statistics.resonanceCounts.FLAME_STORM = maximum
    roundTrip(save)
    save.state.statistics.resonanceCounts.FLAME_STORM++
    expectCode(() => validateSaveData(save), 'STATE')
  })
})

const upgrades: Upgrade[] = ['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER']
function reachedStage8(): SaveDataV1 {
  const save = initial()
  const rng = createCheckpointRandom(save.rng)
  while (save.state.stage < 8) save.state = executeNormalPulls(save.state, 10, rng.random).state
  save.rng = rng.getCheckpoint()
  return save
}

describe('actual game snapshots and ledger security', () => {
  it('accepts real mixed gameplay checkpoints through Stage50 clear and beyond', () => {
    let save = initial()
    const source = createCheckpointRandom(save.rng)
    let operations = 0
    while (save.state.stage <= 50 && operations < 5000) {
      save.state = executeNormalPulls(save.state, 10, source.random).state
      for (const upgrade of upgrades) {
        if (getUpgradeInfo(save.state, upgrade).canPurchase) save.state = purchaseUpgrade(save.state, upgrade)
      }
      if (save.state.highestStage >= 6) save.state = setFocus(save.state, 'THUNDER_FIRE')
      if (save.state.specialGauge >= 30) {
        save.state = executeSpecialPulls(save.state, save.state.highestStage >= 10 ? 'MAX' : 1, source.random).state
      }
      save.rng = source.getCheckpoint()
      save = roundTrip(save)
      operations++
    }
    expect(save.state.stage).toBeGreaterThan(50)
    expect(save.state.statistics.totalNormalPulls).toBeGreaterThan(100)
    const resumed = createCheckpointRandom(save.rng)
    expect(executeNormalPulls(save.state, 10, resumed.random)).toEqual(executeNormalPulls(save.state, 10, source.random))
    expect(resumed.getCheckpoint()).toEqual(source.getCheckpoint())
  })

  it.each(upgrades)('round-trips purchases/RESPEC and rejects forged %s ledger', upgrade => {
    const save = reachedStage8()
    const originalRs = save.state.resonanceShards
    for (let level = 0; level < 3; level++) save.state = purchaseUpgrade(save.state, upgrade)
    save.state = setFocus(save.state, 'WIND_THUNDER')
    const restored = roundTrip(save)
    expect(respecUpgrades(restored.state).resonanceShards).toBe(originalRs)
    for (const delta of [-1, 1, 14]) {
      const forged = structuredClone(save)
      forged.state.spentShards[upgrade] += delta
      expectCode(() => validateSaveData(forged), 'STATE')
    }
    save.state = respecUpgrades(restored.state)
    roundTrip(save)
    save.state = respecUpgrades(save.state)
    expect(roundTrip(save).state.resonanceShards).toBe(originalRs)
  })

  it.each(upgrades)('checks bounded cumulative-price limits for %s', upgrade => {
    const save = reachedStage8()
    let total = 0
    let level = 0
    while (true) {
      const price = calculateUpgradeCost(upgrade, level)
      if (!Number.isSafeInteger(total + price)) break
      total += price
      level++
    }
    save.state.upgradeLevels[upgrade] = level
    save.state.spentShards[upgrade] = total
    save.state.resonanceShards = 0
    roundTrip(save)
    save.state.resonanceShards = Number.MAX_SAFE_INTEGER - total + 1
    expectCode(() => validateSaveData(save), 'STATE')
    save.state.resonanceShards = 0
    save.state.upgradeLevels[upgrade]++
    expectCode(() => validateSaveData(save), 'STATE')
    save.state.upgradeLevels[upgrade] = Number.MAX_SAFE_INTEGER
    expectCode(() => validateSaveData(save), 'STATE')
  })

  it.each(['RESONANCE_POWER', 'SPECIAL_POWER'] as const)('rejects locked paid %s', upgrade => {
    const save = initial()
    save.state.upgradeLevels[upgrade] = 1
    save.state.spentShards[upgrade] = calculateUpgradeCost(upgrade, 0)
    expectCode(() => validateSaveData(save), 'STATE')
  })

  it('rejects payment at Lv0 for each upgrade', () => {
    for (const upgrade of upgrades) {
      const save = initial()
      save.state.spentShards[upgrade] = 14
      expectCode(() => validateSaveData(save), 'STATE')
    }
  })

  it('preserves real stage progression, temporary effects and statistics', () => {
    const save = reachedStage8()
    expect(save.state.stage).toBeGreaterThanOrEqual(8)
    expect(save.state.statistics.bossesDefeated).toBe(save.state.stage - 1)
    roundTrip(save)
  })

  it('preserves all bounded effects at their endpoints and the settings', () => {
    const save = reachedStage8()
    save.state.stacks = { FIRE: 12, WIND: 12, THUNDER: 12 }
    save.state.catalyst = 3
    save.state.statistics.ssrCount = Math.max(3, save.state.statistics.ssrCount)
    save.state.temporary = { boostCount: 3, flameStormPullsRemaining: 10, thunderStormReserved: true }
    save.settings.reducedEffects = true
    roundTrip(save)
  })

  it('round-trips an actual JACKPOT result and its reset interval', () => {
    const save = initial()
    save.state.stage = save.state.highestStage = 20
    save.state.bossHp = calculateBossMaxHp(20)
    Object.assign(save.state.statistics, { totalNormalPulls: 99, ssrCount: 3, bossesDefeated: 19 })
    save.state.jackpot = { pullsInWindow: 99, ssrInWindow: 3 }
    const source = createCheckpointRandom(save.rng)
    const result = executeNormalPull(roundTrip(save).state, source.random)
    expect(result.events.some(event => event.type === 'jackpot-window' && event.triggered)).toBe(true)
    const restored = roundTrip({ ...save, state: result.state, rng: source.getCheckpoint() })
    expect(restored.state.jackpot).toEqual({ pullsInWindow: 0, ssrInWindow: 0 })
    expect(restored.state.statistics.jackpotCount).toBe(1)
  })

  it('continues a CHAIN queue with identical state, summaries and RNG', () => {
    // Seed search is bounded and deterministic: find an actual first-pull CHAIN.
    const save = initial()
    let source = createCheckpointRandom(save.rng)
    for (let seed = 0; seed < 1000; seed++) {
      source = createCheckpointRandom({ algorithm: 'mulberry32-v1', state: seed })
      const first = executeNormalPulls(createInitialGameState(), 10, source.random, 1)
      if (first.state.normalPullQueue.chain > 0) {
        save.state = first.state
        save.rng = source.getCheckpoint()
        break
      }
    }
    expect(save.state.normalPullQueue.chain).toBe(3)
    const restored = roundTrip(save)
    const resumed = createCheckpointRandom(restored.rng)
    const actual = resumePendingNormalPulls(restored.state, resumed.random)
    const expected = resumePendingNormalPulls(save.state, source.random)
    expect(actual).toEqual(expected)
    expect(resumed.getCheckpoint()).toEqual(source.getCheckpoint())
    roundTrip({ ...restored, state: actual.state, rng: resumed.getCheckpoint() })
  })

  it('keeps fixed SPECIAL reservations and continues across JSON boundaries', () => {
    const save = reachedStage8()
    const source = createCheckpointRandom(save.rng)
    // SPECIAL ×1 works before Stage10, so queue a fixed MAX after real progression.
    while (save.state.stage < 10) save.state = executeNormalPulls(save.state, 10, source.random).state
    save.state = executeSpecialPulls(save.state, 'MAX', source.random, 1).state
    save.rng = source.getCheckpoint()
    expect(save.state.pendingSpecialPulls).toBeGreaterThan(0)
    const restored = roundTrip(save)
    const resumed = createCheckpointRandom(restored.rng)
    expect(resumePendingSpecialPulls(restored.state, resumed.random)).toEqual(resumePendingSpecialPulls(save.state, source.random))
    expect(resumed.getCheckpoint()).toEqual(source.getCheckpoint())
  })

  it('round-trips a Stage50 defeat without storing clear animation or UI fields', () => {
    const save = initial()
    save.state.stage = save.state.highestStage = 50
    save.state.bossHp = 1
    save.state.statistics.bossesDefeated = 49
    save.state.statistics.totalNormalPulls = 49
    const source = createCheckpointRandom(save.rng)
    const result = executeNormalPull(save.state, source.random)
    expect(result.events.some(event => event.type === 'game-cleared')).toBe(true)
    save.state = result.state
    save.rng = source.getCheckpoint()
    const restored = roundTrip(save)
    expect(restored.state.stage).toBe(51)
    expect(restored.state.bossHp).toBe(calculateBossMaxHp(51))
    expect(executeNormalPull(restored.state, source.random).events.some(event => event.type === 'game-cleared')).toBe(false)
    expect(Object.keys(restored)).toEqual(['saveVersion', 'state', 'settings', 'rng'])
  })
})
