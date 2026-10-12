import { describe, expect, it, vi } from 'vitest'
import { calculateBossMaxHp } from '../game/boss'
import { createInitialGameState, executeNormalPulls } from '../game/engine'
import { purchaseUpgrade, respecUpgrades } from '../game/upgrades'
import { setFocus } from '../game/progression'
import { sequenceRng } from '../test/random'
import type { Focus, GameState, Upgrade } from '../types/game'
import { createBattleController } from './battleController'

function funded(stage = 8): GameState {
  return { ...createInitialGameState(), stage, highestStage: stage, bossHp: calculateBossMaxHp(stage), resonanceShards: 1000, specialGauge: 300 }
}
const frame = async () => {}
describe('controller synchronous progression actions', () => {
  it.each(['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER'] as Upgrade[])('%s uses the core atomically and rejects a repeated stale command', (upgrade) => {
    const state = funded()
    const before = structuredClone(state)
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ initialState: state, rng })
    const listener = vi.fn()
    const stop = controller.subscribe(listener)
    expect(controller.purchase(upgrade, state)).toBe(true)
    expect(controller.getSnapshot().state).toEqual(purchaseUpgrade(state, upgrade))
    expect(listener).toHaveBeenCalledTimes(1)
    const bought = controller.getSnapshot().state
    expect(controller.purchase(upgrade, state)).toBe(false)
    expect(controller.getSnapshot().state).toBe(bought)
    expect(controller.getSnapshot().notice?.text).toContain('表示が更新')
    expect(state).toEqual(before)
    expect(rng).not.toHaveBeenCalled()
    stop()
  })
  it('refunds once, keeps prior pull summary, and rechecks latest state', async () => {
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ initialState: funded(), rng, yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 1 })
    const state = controller.getSnapshot().state
    const summary = controller.getSnapshot().result
    controller.purchase('PULL_POWER', state)
    const bought = controller.getSnapshot().state
    const calls = rng.mock.calls.length
    expect(controller.respec(bought)).toBe(true)
    expect(controller.getSnapshot().state).toEqual(respecUpgrades(bought))
    expect(controller.respec(bought)).toBe(false)
    expect(controller.getSnapshot().state).toEqual(state)
    expect(controller.getSnapshot().result).toBe(summary)
    expect(rng).toHaveBeenCalledTimes(calls)
  })
  it.each(['BALANCED', 'FIRE_WIND', 'WIND_THUNDER', 'THUNDER_FIRE'] as Focus[])('changes %s without RNG and subsequent pulls use core probabilities/priorities', async (focus) => {
    const state = funded(6)
    state.stacks = { FIRE: 6, WIND: 6, THUNDER: 6 }
    const expected = executeNormalPulls(setFocus(state, focus), 1, sequenceRng([0, 0.4, 0]))
    const rng = vi.fn(sequenceRng([0, 0.4, 0]))
    const controller = createBattleController({ initialState: state, rng, yieldFrame: frame })
    expect(controller.changeFocus(focus, state)).toBe(true)
    expect(rng).not.toHaveBeenCalled()
    await controller.start({ kind: 'normal', count: 1 })
    expect(controller.getSnapshot().state).toEqual(expected.state)
  })
  it('rejects locked, insufficient and malformed actions without replacing state', () => {
    const state = createInitialGameState()
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ initialState: state, rng })
    expect(controller.purchase('PULL_POWER', state)).toBe(false)
    expect(controller.purchase('SPECIAL_POWER', state)).toBe(false)
    expect(controller.changeFocus('FIRE_WIND', state)).toBe(false)
    expect(controller.changeFocus('invalid' as Focus, state)).toBe(false)
    expect(controller.getSnapshot().state).toBe(state)
    expect(rng).not.toHaveBeenCalled()
    const invalid = funded()
    invalid.spentShards.PULL_POWER = 1
    const malformed = createBattleController({ initialState: invalid, rng })
    expect(malformed.respec(invalid)).toBe(false)
    expect(malformed.getSnapshot().state).toBe(invalid)
  })
  it.each(['base', 'chain', 'special'] as const)('blocks every progression API with pending %s', (kind) => {
    const state = purchaseUpgrade(funded(), 'PULL_POWER')
    if (kind === 'special') state.pendingSpecialPulls = 1
    else { state.pendingNormalPulls = 1; state.normalPullQueue[kind] = 1 }
    const before = structuredClone(state)
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ initialState: state, rng })
    expect(controller.purchase('PULL_POWER', state)).toBe(false)
    expect(controller.respec(state)).toBe(false)
    expect(controller.changeFocus('FIRE_WIND', state)).toBe(false)
    expect(controller.getSnapshot().state).toEqual(before)
    expect(controller.getSnapshot().notice?.text).toContain('保留PULL')
    expect(rng).not.toHaveBeenCalled()
  })
  it('blocks actions between async chunks and keeps queue/RNG continuity', async () => {
    let release!: () => void
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ initialState: purchaseUpgrade(funded(), 'PULL_POWER'), rng, chunkSize: 1, yieldFrame: () => new Promise<void>((resolve) => { release = resolve }) })
    const running = controller.start({ kind: 'normal', count: 10 })
    release(); await Promise.resolve(); await Promise.resolve()
    const committed = controller.getSnapshot().state
    expect(controller.purchase('PULL_POWER', committed)).toBe(false)
    expect(controller.respec(committed)).toBe(false)
    expect(controller.changeFocus('FIRE_WIND', committed)).toBe(false)
    expect(controller.getSnapshot().state).toBe(committed)
    expect(rng).toHaveBeenCalledTimes(3)
    for (let i = 0; i < 9; i++) { release(); await Promise.resolve(); await Promise.resolve() }
    await running
    expect(controller.getSnapshot().state.statistics.totalNormalPulls).toBe(10)
    expect(controller.purchase('PULL_POWER', controller.getSnapshot().state)).toBe(true)
  })
  it('rejects actions after the 10,000 safety pause, without touching summary or stream', async () => {
    let index = 0
    const rng = vi.fn(() => index++ % 3 === 2 ? 0.93 : 0)
    const controller = createBattleController({ initialState: funded(), rng, yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 1 })
    const paused = controller.getSnapshot()
    expect(paused.paused).toBe(true)
    expect(controller.purchase('PULL_POWER', paused.state)).toBe(false)
    expect(controller.respec(paused.state)).toBe(false)
    expect(controller.changeFocus('FIRE_WIND', paused.state)).toBe(false)
    expect(controller.getSnapshot().state).toBe(paused.state)
    expect(controller.getSnapshot().result).toBe(paused.result)
    expect(controller.getSnapshot().paused).toBe(true)
    expect(rng).toHaveBeenCalledTimes(30_000)
  })
  it('keeps failure queues and summaries intact when progression is requested', async () => {
    let calls = 0
    const rng = vi.fn(() => { if (++calls === 4) throw new Error('interrupt'); return 0 })
    const controller = createBattleController({ initialState: funded(), rng, chunkSize: 1, yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 10 })
    const failed = controller.getSnapshot()
    expect(controller.respec(failed.state)).toBe(false)
    expect(controller.getSnapshot().error).toBe(failed.error)
    expect(controller.getSnapshot().result).toBe(failed.result)
    expect(controller.getSnapshot().state).toBe(failed.state)
    expect(rng).toHaveBeenCalledTimes(4)
  })
})
