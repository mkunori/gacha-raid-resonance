import { describe, expect, it, vi } from 'vitest'
import { seededRng, sequenceRng } from '../test/random'
import type { Element, Focus, GameState, Resonance, Upgrade } from '../types/game'
import { calculateBossMaxHp, calculateBossReward, finishBossDefeat, getBossInfo } from './boss'
import {
  createInitialGameState, executeNormalPull, executeNormalPulls, executeSpecialPull,
  executeSpecialPulls, resumePendingNormalPulls, resumePendingSpecialPulls,
} from './engine'
import { hasClearedGame, isFeatureUnlocked, isUpgradeUnlocked, setFocus, type Feature } from './progression'

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

// Independent expectations transcribed from GAME_SPEC chapter 5; do not derive from configuration.
const bosses = [
  { stage: 5, name: 'ゴーレム', normal: [0.75, 0.75, 0.75], resonance: [1.25, 1.25, 1.25], special: 1, gauge: 12 },
  { stage: 10, name: '炎竜', normal: [0.5, 1, 1], resonance: [1, 1.5, 1], special: 1, gauge: 12 },
  { stage: 15, name: '虚空の術師', normal: [0.85, 0.85, 0.85], resonance: [1, 1, 1], special: 1.8, gauge: 12 },
  { stage: 20, name: '共鳴封印獣', normal: [1.7, 1.7, 1.7], resonance: [0.7, 0.7, 0.7], special: 1, gauge: 12 },
  { stage: 25, name: '雷獣', normal: [1, 1, 1], resonance: [1, 1, 1], special: 1, gauge: 24 },
  { stage: 30, name: '裂界竜', normal: [0.8, 1, 1], resonance: [1, 1.5, 1], special: 1, gauge: 12 },
  { stage: 35, name: 'ゴーレム＋術師複合', normal: [0.75 * 0.85, 0.75 * 0.85, 0.75 * 0.85], resonance: [1.25, 1.25, 1.25], special: 1.8, gauge: 12 },
  { stage: 40, name: '炎竜＋封印複合', normal: [0.5 * 1.7, 1.7, 1.7], resonance: [0.7, 1.5 * 0.7, 0.7], special: 1, gauge: 12 },
  { stage: 45, name: '術師＋雷獣複合', normal: [0.85, 0.85, 0.85], resonance: [1, 1, 1], special: 1.8, gauge: 24 },
  { stage: 50, name: '裂界竜強化', normal: [0.8, 1, 1], resonance: [1, 1.5, 1], special: 1, gauge: 12 },
]
const elements: Element[] = ['FIRE', 'WIND', 'THUNDER']
const resonances: Resonance[] = ['FLAME_STORM', 'THUNDER_STORM', 'OVERLOAD']
const rolls = [0, 0.5, 0.9]

describe.each(bosses)('Stage $stage channel modifiers', (boss) => {
  it('exposes name and detached readonly trait data', () => {
    const info = getBossInfo(boss.stage)
    expect(info.name).toBe(boss.name)
    expect(info.description).toContain(`OVERLOADゲージ+${boss.gauge}`)
    expect(info.overloadGaugeGain).toBe(boss.gauge)
    expect(Object.values(info.normalMultipliers)).toEqual(boss.normal)
    expect(Object.values(info.resonanceMultipliers)).toEqual(boss.resonance)
    expect(info.specialMultiplier).toBe(boss.special)
    const mutableCopy = info.normalMultipliers as Record<Element, number>
    mutableCopy.FIRE = 999
    expect(getBossInfo(boss.stage).normalMultipliers.FIRE).toBe(boss.normal[0])
  })
  it.each(elements)('applies %s NORMAL modifier and preserves input', (element) => {
    const index = elements.indexOf(element)
    const input = freezeDeep(atStage(boss.stage))
    const rng = vi.fn(sequenceRng([0, rolls[index], 0]))
    const result = executeNormalPull(input, rng)
    expect(result.events).toContainEqual({ type: 'normal-damage', stage: boss.stage, damage: 10 * boss.normal[index] })
    expect(result.state.bossHp).toBeCloseTo(input.bossHp - 10 * boss.normal[index])
    expect(input).toEqual(atStage(boss.stage))
    expect(rng).toHaveBeenCalledTimes(3)
  })
  it.each(resonances)('applies %s modifier with exact 3+3 consumption and actual gauge event', (resonance) => {
    const state = atStage(boss.stage)
    const index = resonances.indexOf(resonance)
    state.stacks = index === 0 ? { FIRE: 2, WIND: 3, THUNDER: 0 }
      : index === 1 ? { FIRE: 0, WIND: 2, THUNDER: 3 } : { FIRE: 3, WIND: 0, THUNDER: 2 }
    const result = executeNormalPull(freezeDeep(state), sequenceRng([0, rolls[index], 0]))
    const event = result.events.find((e) => e.type === 'resonance')!
    expect(event.resonance).toBe(resonance)
    expect(event.damage).toBeCloseTo(240 * (index === 0 ? 1.5 : 1) * boss.resonance[index])
    expect(result.state.stacks).toEqual({ FIRE: 0, WIND: 0, THUNDER: 0 })
    expect(result.state.specialGauge).toBe(index === 2 ? boss.gauge + 1 : 1)
    if (index === 2) expect(result.events).toContainEqual({ type: 'gauge-gained', stage: boss.stage, amount: boss.gauge, source: 'overload' })
  })
  it.each([[0, 20], [0.75, 40], [0.95, 100]])('applies SPECIAL modifier at roll %s without NORMAL effects', (roll, multiplier) => {
    const state = atStage(boss.stage)
    state.specialGauge = 60
    state.upgradeLevels.PULL_POWER = 1
    state.upgradeLevels.SPECIAL_POWER = 2
    state.catalyst = 3
    state.temporary = { boostCount: 3, thunderStormReserved: true, flameStormPullsRemaining: 10 }
    const before = structuredClone(state)
    const result = executeSpecialPull(freezeDeep(state), () => roll)
    expect(result.events.find((e) => e.type === 'special-damage')!.damage).toBeCloseTo(12 * multiplier * 1.1 ** 2 * boss.special)
    expect(result.state.specialGauge).toBe(30)
    expect(result.state.temporary).toEqual(before.temporary)
    expect(result.state.catalyst).toBe(3)
    expect(result.state.jackpot).toEqual(before.jackpot)
    expect(state).toEqual(before)
  })
})

describe('compound effects and channel boundaries', () => {
  it.each([35, 40])('multiplies Stage %s FLAME immediate damage with all reserved amplifiers', (stage) => {
    const state = atStage(stage)
    state.stacks = { FIRE: 2, WIND: 3, THUNDER: 0 }
    state.catalyst = 1
    state.temporary = { boostCount: 3, thunderStormReserved: true, flameStormPullsRemaining: 0 }
    const result = executeNormalPull(state, () => 0)
    const event = result.events.find((e) => e.type === 'resonance')!
    expect(event.resonance).toBe('FLAME_STORM')
    expect(event.damage).toBeCloseTo(240 * 1.5 * 1.4 * 1.5 * 1.75 * (stage === 35 ? 1.25 : 0.7))
    expect(result.state.temporary).toEqual({ boostCount: 0, thunderStormReserved: false, flameStormPullsRemaining: 10 })
    expect(result.state.catalyst).toBe(0)
  })
  it.each([35, 40])('multiplies Stage %s traits with FLAME, THUNDER, new catalyst and BOOST', (stage) => {
    const state = atStage(stage)
    state.stacks = { FIRE: 0, WIND: 0, THUNDER: 3 }
    state.temporary = { boostCount: 3, thunderStormReserved: true, flameStormPullsRemaining: 10 }
    const result = executeNormalPull(state, sequenceRng([0.99, 0.5, 0.98]))
    const normal = stage === 35 ? 0.75 * 0.85 : 1.7
    const resonance = stage === 35 ? 1.25 : 1.5 * 0.7
    expect(result.events.find((e) => e.type === 'normal-damage')!.damage).toBeCloseTo(120 * 1.15 * normal)
    expect(result.events.find((e) => e.type === 'resonance')!.damage).toBeCloseTo(240 * 1.4 * 1.5 * 1.75 * resonance)
    expect(result.state.catalyst).toBe(0)
    expect(result.state.temporary.boostCount).toBe(1) // New BOOST is acquired after resonance.
    expect(result.state.temporary.thunderStormReserved).toBe(true)
  })
  it.each(bosses.filter((boss) => boss.stage >= 20))('never modifies JACKPOT at Stage $stage', ({ stage }) => {
    const state = atStage(stage)
    state.jackpot = { pullsInWindow: 99, ssrInWindow: 3 }
    const result = executeNormalPull(state, () => 0)
    expect(result.events).toContainEqual({ type: 'jackpot-window', stage, ssrCount: 3, triggered: true, damage: 1800, gaugeGain: 30 })
    expect(result.state.specialGauge).toBe(31)
  })
  it.each([1, 4, 6, 49, 51, 52, 60])('uses ordinary traits at Stage %s', (stage) => {
    const info = getBossInfo(stage)
    expect(Object.values(info.normalMultipliers)).toEqual([1, 1, 1])
    expect(Object.values(info.resonanceMultipliers)).toEqual([1, 1, 1])
    expect(info.specialMultiplier).toBe(1)
    expect(info.overloadGaugeGain).toBe(12)
  })
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid boss Stage %s', (stage) => {
    expect(() => getBossInfo(stage)).toThrow(RangeError)
  })
  it('uses only the original Stage modifiers even when NORMAL kills before all resonances', () => {
    const state = atStage(40)
    state.bossHp = 1
    state.focus = 'WIND_THUNDER'
    state.stacks = { FIRE: 2, WIND: 6, THUNDER: 3 }
    const result = executeNormalPull(state, () => 0)
    const events = result.events.filter((e) => e.type === 'resonance')
    expect(events.map((e) => e.resonance)).toEqual(['THUNDER_STORM', 'FLAME_STORM'])
    expect(events[0].damage).toBeCloseTo(240 * (0.7 * 1.5))
    expect(events[1].damage).toBeCloseTo(240 * 1.4 * 1.5 * 0.7)
    expect(result.state.stage).toBe(41)
    expect(result.events.at(-1)!.type).toBe('stage-started')
  })
  it('selects the new Stage40 modifiers for remaining CHAIN and base pulls', () => {
    const state = { ...atStage(39), bossHp: 1 }
    const paused = executeNormalPulls(state, 10, sequenceRng([0, 0, 0.93]), 1)
    expect(paused.state.stage).toBe(40)
    expect(paused.state.normalPullQueue).toEqual({ base: 9, chain: 3 })
    const next = resumePendingNormalPulls(paused.state, () => 0, 4)
    expect(next.state.bossHp).toBeCloseTo(calculateBossMaxHp(40) - 4 * 8.5)
    expect(next.state.normalPullQueue).toEqual({ base: 8, chain: 0 })
  })
  it('selects ordinary SPECIAL modifiers after defeating Stage35 in a MAX reservation', () => {
    const state = { ...atStage(35), bossHp: 1, specialGauge: 60 }
    const result = executeSpecialPulls(state, 'MAX', () => 0)
    expect(result.state.stage).toBe(36)
    expect(result.state.bossHp).toBe(calculateBossMaxHp(36) - 200)
    expect(result.summary.actualPulls).toBe(2)
    expect(result.summary.earnedShards).toBe(calculateBossReward(35))
  })
  it.each(['normal', 'resonance', 'special'] as const)('rejects %s multiplier overflow without modifying the input', (channel) => {
    const state = atStage(channel === 'special' ? 35 : 40)
    state.specialGauge = 30
    if (channel === 'normal') state.upgradeLevels.PULL_POWER = 189
    if (channel === 'resonance') {
      state.stacks = { FIRE: 0, WIND: 2, THUNDER: 3 }
      state.upgradeLevels.RESONANCE_POWER = 410
      state.temporary.boostCount = 3
    }
    if (channel === 'special') state.upgradeLevels.SPECIAL_POWER = 330
    const before = structuredClone(state)
    expect(() => channel === 'special' ? executeSpecialPull(freezeDeep(state), () => 0.95)
      : executeNormalPull(freezeDeep(state), sequenceRng([0, 0.5, 0]))).toThrow(RangeError)
    expect(state).toEqual(before)
  })
})

const unlocks: [Feature, number][] = [
  ['FOCUS', 6], ['SPECIAL_MAX', 10], ['NORMAL_100', 15], ['JACKPOT', 20], ['NORMAL_1000', 50],
]
describe('arrival-based unlocks and focus', () => {
  it.each(unlocks)('%s unlocks at highestStage %s and stays unlocked', (feature, stage) => {
    expect(isFeatureUnlocked(atStage(stage - 1), feature)).toBe(false)
    expect(isFeatureUnlocked(atStage(stage), feature)).toBe(true)
    expect(isFeatureUnlocked(atStage(stage + 1), feature)).toBe(true)
    expect(isFeatureUnlocked({ highestStage: 60 }, feature)).toBe(true)
  })
  it.each(['NORMAL_1', 'NORMAL_10', 'SPECIAL_1'] as const)('%s is available initially', (feature) => {
    expect(isFeatureUnlocked(createInitialGameState(), feature)).toBe(true)
  })
  it.each([['PULL_POWER', 1], ['RESONANCE_POWER', 6], ['SPECIAL_POWER', 8]] as const)('%s upgrade unlocks at %s without purchasing', (upgrade, stage) => {
    if (stage > 1) expect(isUpgradeUnlocked(atStage(stage - 1), upgrade)).toBe(false)
    expect(isUpgradeUnlocked(atStage(stage), upgrade)).toBe(true)
    expect(isUpgradeUnlocked(atStage(stage + 1), upgrade)).toBe(true)
    expect(atStage(stage).upgradeLevels[upgrade]).toBe(0)
  })
  it.each([[100, 15], [1000, 50]] as const)('rejects locked NORMAL x%s before RNG and accepts arrival at %s', (count, stage) => {
    const locked = freezeDeep(atStage(stage - 1))
    const rng = vi.fn(() => 0)
    expect(() => executeNormalPulls(locked, count, rng)).toThrow(/locked/)
    expect(rng).not.toHaveBeenCalled()
    expect(locked).toEqual(atStage(stage - 1))
    const started = executeNormalPulls(atStage(stage), count, rng, 1)
    expect(started.state.pendingNormalPulls).toBe(count - 1)
    expect(rng).toHaveBeenCalledTimes(3)
  })
  it('rejects locked SPECIAL MAX without RNG, permits single, and unlocks on Stage10 arrival', () => {
    const rng = vi.fn(() => 0)
    const locked = { ...atStage(9), specialGauge: 90 }
    expect(() => executeSpecialPulls(freezeDeep(locked), 'MAX', rng)).toThrow(/locked/)
    expect(rng).not.toHaveBeenCalled()
    expect(executeSpecialPulls(locked, 1, rng).summary.actualPulls).toBe(1)
    expect(executeSpecialPulls({ ...atStage(10), specialGauge: 90 }, 'MAX', rng, 1).state.pendingSpecialPulls).toBe(2)
    expect(rng).toHaveBeenCalledTimes(2)
  })
  it.each([[100, 16], [1000, 51]] as const)('accepts NORMAL x%s after its unlock at Stage %s', (count, stage) => {
    expect(executeNormalPulls(atStage(stage), count, () => 0, 1).state.pendingNormalPulls).toBe(count - 1)
  })
  it('accepts SPECIAL MAX after Stage10 and maintains unlock when current Stage is lower than highest', () => {
    expect(executeSpecialPulls({ ...atStage(11), specialGauge: 60 }, 'MAX', () => 0).summary.actualPulls).toBe(2)
    expect(executeNormalPulls({ ...atStage(1), highestStage: 50 }, 1000, () => 0, 1).state.pendingNormalPulls).toBe(999)
  })
  it('unlocks NORMAL1000 at Stage50 arrival, before game clear', () => {
    const state = { ...atStage(49), bossHp: 1 }
    expect(isFeatureUnlocked(state, 'NORMAL_1000')).toBe(false)
    const next = executeNormalPulls(state, 1, () => 0).state
    expect(next.stage).toBe(50)
    expect(hasClearedGame(next)).toBe(false)
    expect(executeNormalPulls(next, 1000, () => 0, 1).state.pendingNormalPulls).toBe(999)
  })
  it('unlocks focus and RESONANCE POWER only after Stage5 defeat', () => {
    const state = atStage(5)
    state.bossHp = 1
    expect(isUpgradeUnlocked(state, 'RESONANCE_POWER')).toBe(false)
    expect(() => setFocus(state, 'FIRE_WIND')).toThrow(/locked/)
    const next = executeNormalPull(state, () => 0).state
    expect(isUpgradeUnlocked(next, 'RESONANCE_POWER')).toBe(true)
    expect(setFocus(next, 'FIRE_WIND').focus).toBe('FIRE_WIND')
  })
  it.each(['BALANCED', 'FIRE_WIND', 'WIND_THUNDER', 'THUNDER_FIRE'] as const)('switches to %s without mutating input', (focus) => {
    const input = freezeDeep(atStage(6))
    const result = setFocus(input, focus)
    expect(result.focus).toBe(focus)
    expect(input).toEqual(atStage(6))
    expect(result.stacks).toBe(input.stacks) // Immutable snapshot contract.
    expect(result.normalPullQueue).toBe(input.normalPullQueue)
  })
  it.each(['FIRE_WIND', 'WIND_THUNDER', 'THUNDER_FIRE'] as const)('rejects locked %s and tampered state before either RNG path', (focus) => {
    const state = atStage(5)
    expect(() => setFocus(state, focus)).toThrow(/locked/)
    state.focus = focus
    state.specialGauge = 30
    const rng = vi.fn(() => 0)
    expect(() => executeNormalPull(state, rng)).toThrow(/locked/)
    expect(() => executeSpecialPull(state, rng)).toThrow(/locked/)
    expect(rng).not.toHaveBeenCalled()
  })
  it('allows BALANCED before focus unlock', () => {
    expect(setFocus(atStage(5), 'BALANCED').focus).toBe('BALANCED')
  })
  it.each([
    ['BALANCED', 'FIRE', 'FLAME_STORM'], ['FIRE_WIND', 'FIRE', 'FLAME_STORM'],
    ['WIND_THUNDER', 'WIND', 'THUNDER_STORM'], ['THUNDER_FIRE', 'FIRE', 'OVERLOAD'],
  ] as const)('%s changes both distribution and resonance priority', (focus, element, resonance) => {
    const state = setFocus(atStage(6), focus)
    state.stacks = { FIRE: 3, WIND: 3, THUNDER: 3 }
    const result = executeNormalPull(state, sequenceRng([0, 0.2, 0]))
    expect(result.events.find((e) => e.type === 'normal-pull')!.result.element).toBe(element)
    expect(result.events.find((e) => e.type === 'resonance')!.resonance).toBe(resonance)
  })
  it.each(['normal', 'special'] as const)('forbids focus changes during pending %s, preserves queue and allows resume', (kind) => {
    const state = atStage(10)
    state.specialGauge = 90
    const pending = kind === 'normal' ? executeNormalPulls(state, 10, () => 0, 1).state
      : executeSpecialPulls(state, 'MAX', () => 0, 1).state
    const before = structuredClone(pending)
    expect(() => setFocus(freezeDeep(pending), 'BALANCED')).toThrow(/Resume/)
    expect(pending).toEqual(before)
    const resumed = kind === 'normal' ? resumePendingNormalPulls(pending, () => 0) : resumePendingSpecialPulls(pending, () => 0)
    expect(resumed.summary.pendingPulls).toBe(0)
  })
  it('does not reapply count unlocks to an existing serialized reservation', () => {
    const state = atStage(1)
    state.pendingNormalPulls = state.normalPullQueue.base = 100
    expect(resumePendingNormalPulls(state, () => 0, 1).state.pendingNormalPulls).toBe(99)
    const special = { ...atStage(1), pendingSpecialPulls: 2, specialGauge: 60 }
    expect(resumePendingSpecialPulls(special, () => 0, 1).state.pendingSpecialPulls).toBe(1)
  })
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid highestStage %s', (highestStage) => {
    expect(() => isFeatureUnlocked({ highestStage }, 'FOCUS')).toThrow(RangeError)
    expect(() => isUpgradeUnlocked({ highestStage }, 'PULL_POWER')).toThrow(RangeError)
    expect(() => hasClearedGame({ highestStage })).toThrow(RangeError)
  })
  it('rejects unknown feature, upgrade, focus and inconsistent focus state', () => {
    expect(() => isFeatureUnlocked(atStage(6), 'bad' as Feature)).toThrow(RangeError)
    expect(() => isUpgradeUnlocked(atStage(6), 'bad' as Upgrade)).toThrow(RangeError)
    expect(() => setFocus(atStage(6), 'bad' as Focus)).toThrow(RangeError)
    expect(() => setFocus({ ...atStage(6), highestStage: 5 }, 'BALANCED')).toThrow(RangeError)
  })
})

describe('Stage50 clear and continued play', () => {
  it('does not clear merely on reaching or damaging Stage50', () => {
    const result = executeNormalPull(atStage(50), () => 0)
    expect(hasClearedGame(result.state)).toBe(false)
    expect(result.events.some((e) => e.type === 'game-cleared')).toBe(false)
  })
  it.each(['normal', 'resonance', 'special', 'jackpot'] as const)('clears through %s once, rewards Stage50 and starts ordinary Stage51', (channel) => {
    const state = atStage(50)
    state.bossHp = channel === 'normal' || channel === 'special' ? 1 : channel === 'resonance' ? 200 : 1000
    state.catalyst = 2
    state.specialGauge = 91
    if (channel === 'resonance') state.stacks = { FIRE: 2, WIND: 3, THUNDER: 0 }
    if (channel === 'jackpot') state.jackpot = { pullsInWindow: 99, ssrInWindow: 3 }
    const before = structuredClone(state)
    const result = channel === 'special' ? executeSpecialPull(freezeDeep(state), () => 0)
      : executeNormalPull(freezeDeep(state), () => 0)
    expect(result.state.stage).toBe(51)
    expect(hasClearedGame(state)).toBe(false)
    expect(hasClearedGame(result.state)).toBe(true)
    expect(result.state.highestStage).toBe(51)
    expect(result.state.resonanceShards).toBe(calculateBossReward(50))
    expect(result.state.bossHp).toBe(calculateBossMaxHp(51))
    expect(result.events.slice(-3)).toEqual([
      { type: 'boss-defeated', stage: 50, reward: calculateBossReward(50) },
      { type: 'game-cleared', stage: 50 },
      { type: 'stage-started', stage: 51, maxHp: calculateBossMaxHp(51) },
    ])
    expect(isFeatureUnlocked(result.state, 'NORMAL_1000')).toBe(true)
    expect(state).toEqual(before)
    const next = executeNormalPull({ ...result.state, bossHp: 1 }, () => 0)
    expect(next.state.stage).toBe(52)
    expect(next.events.some((e) => e.type === 'game-cleared')).toBe(false)
    expect(next.events).toContainEqual({ type: 'normal-damage', stage: 51, damage: 10 })
    const special = executeSpecialPull(next.state, () => 0)
    expect(special.events).toContainEqual({ type: 'special-damage', stage: 52, damage: 200 })
  })
  it('never reemits clear when highestStage already records it', () => {
    const state = { ...atStage(50), highestStage: 60, bossHp: 0 }
    const result = finishBossDefeat(state)
    expect(result.state.highestStage).toBe(60)
    expect(hasClearedGame(result.state)).toBe(true)
    expect(result.events.some((e) => e.type === 'game-cleared')).toBe(false)
  })
  it('preserves base and CHAIN queues at clear and aggregates the event only in the clearing chunk', () => {
    const state = atStage(50)
    state.bossHp = 1
    const rng = sequenceRng([0, 0, 0.93, ...Array(36).fill(0)])
    const paused = executeNormalPulls(freezeDeep(state), 10, rng, 1)
    expect(paused.state.normalPullQueue).toEqual({ base: 9, chain: 3 })
    expect(paused.state.pendingNormalPulls).toBe(12)
    expect(paused.summary.clearedGame).toBe(true)
    expect(paused.summary.earnedShards).toBe(calculateBossReward(50))
    const done = resumePendingNormalPulls(paused.state, rng)
    expect(done.summary.actualPulls).toBe(12)
    expect(done.summary.clearedGame).toBe(false)
    expect(done.state.statistics.totalNormalPulls).toBe(13)
    expect(done.state.jackpot.pullsInWindow).toBe(13)
    expect(done.state.stage).toBe(51)
  })
  it('preserves fixed SPECIAL MAX reservations at clear without recomputing from gauge', () => {
    const state = { ...atStage(50), bossHp: 1, specialGauge: 95 }
    const paused = executeSpecialPulls(freezeDeep(state), 'MAX', () => 0, 1)
    expect(paused.summary.clearedGame).toBe(true)
    expect(paused.state.pendingSpecialPulls).toBe(2)
    expect(paused.state.specialGauge).toBe(65)
    const done = resumePendingSpecialPulls(paused.state, () => 0)
    expect(done.summary.clearedGame).toBe(false)
    expect(done.summary.actualPulls).toBe(2)
    expect(done.state.pendingSpecialPulls).toBe(0)
    expect(done.state.specialGauge).toBe(5)
    expect(done.state.stage).toBe(51)
  })
  it.each(['normal', 'special'] as const)('continues %s batch through multiple post-clear bosses with bounded summaries', (kind) => {
    const state = { ...atStage(50), bossHp: 1, specialGauge: 30_000 }
    state.upgradeLevels.PULL_POWER = 90
    const result = kind === 'normal' ? executeNormalPulls(state, 1000, () => 0)
      : executeSpecialPulls(state, 'MAX', () => 0)
    expect(result.summary.actualPulls).toBe(1000)
    expect(result.summary.clearedGame).toBe(true)
    expect(result.summary.stagesAdvanced).toBeGreaterThan(1)
    expect(result.state.stage).toBe(50 + result.summary.stagesAdvanced)
    let reward = 0
    for (let stage = 50; stage < result.state.stage; stage++) reward += calculateBossReward(stage)
    expect(result.state.resonanceShards).toBe(reward)
    expect(result.state.pendingNormalPulls + result.state.pendingSpecialPulls).toBe(0)
    expect(JSON.stringify(result.summary).length).toBeLessThan(600)
    expect('events' in result).toBe(false)
  })
  it.each(['normal', 'special'] as const)('seeded %s replay matches JSON-resumed execution through clear including RNG continuation', (kind) => {
    const state = { ...atStage(50), bossHp: 1, specialGauge: 3005 }
    const fullRng = seededRng(42)
    const rng = seededRng(42)
    if (kind === 'normal') {
      const full = executeNormalPulls(state, 1000, fullRng)
      let chunk = executeNormalPulls(state, 1000, rng, 7)
      let cleared = chunk.summary.clearedGame
      while (chunk.state.pendingNormalPulls) {
        chunk = resumePendingNormalPulls(JSON.parse(JSON.stringify(chunk.state)), rng, 7)
        cleared ||= chunk.summary.clearedGame
      }
      expect(chunk.state).toEqual(full.state)
      expect(cleared).toBe(full.summary.clearedGame)
    } else {
      const full = executeSpecialPulls(state, 'MAX', fullRng)
      let chunk = executeSpecialPulls(state, 'MAX', rng, 7)
      let cleared = chunk.summary.clearedGame
      while (chunk.state.pendingSpecialPulls) {
        chunk = resumePendingSpecialPulls(JSON.parse(JSON.stringify(chunk.state)), rng, 7)
        cleared ||= chunk.summary.clearedGame
      }
      expect(chunk.state).toEqual(full.state)
      expect(cleared).toBe(full.summary.clearedGame)
    }
    expect(rng()).toBe(fullRng())
  })
})
