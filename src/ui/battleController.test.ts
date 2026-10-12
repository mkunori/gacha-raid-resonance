import { describe, expect, it, vi } from 'vitest'
import { calculateBossMaxHp } from '../game/boss'
import { createInitialGameState, executeNormalPulls, executeSpecialPulls } from '../game/engine'
import { seededRng } from '../test/random'
import { createBattleController, mergeSummary } from './battleController'
import { formatNumber } from './format'

const frame = async () => {}
function initial(stage = 50) {
  return { ...createInitialGameState(), stage, highestStage: stage, bossHp: calculateBossMaxHp(stage), specialGauge: 60_000 }
}

describe('UI chunk execution', () => {
  it.each([1, 10, 100, 1000] as const)('NORMAL ×%s matches a single core invocation including CHAIN', async (count) => {
    const state = initial()
    const before = structuredClone(state)
    const rng = vi.fn(seededRng(0x12345678))
    const expected = executeNormalPulls(state, count, seededRng(0x12345678))
    const yieldFrame = vi.fn(frame)
    const controller = createBattleController({ initialState: state, rng, chunkSize: 7, yieldFrame })
    expect(await controller.start({ kind: 'normal', count })).toBe(true)
    expect(controller.getSnapshot().state).toEqual(expected.state)
    expect(controller.getSnapshot().result).toEqual({ kind: 'normal', value: expected.summary })
    expect(rng).toHaveBeenCalledTimes(expected.summary.actualPulls * 3)
    expect(yieldFrame).toHaveBeenCalledTimes(Math.ceil(expected.summary.actualPulls / 7))
    expect(state).toEqual(before)
    expect(controller.getSnapshot().result).not.toHaveProperty('events')
  })
  it.each([1, 'MAX'] as const)('SPECIAL ×%s keeps the fixed reservation across chunks and bosses', async (count) => {
    const state = initial(10)
    state.specialGauge = 6000
    const expected = executeSpecialPulls(state, count, seededRng(42))
    const rng = vi.fn(seededRng(42))
    const controller = createBattleController({ initialState: state, rng, chunkSize: 3, yieldFrame: frame })
    await controller.start({ kind: 'special', count })
    expect(controller.getSnapshot().state).toEqual(expected.state)
    expect(controller.getSnapshot().result).toEqual({ kind: 'special', value: expected.summary })
    expect(rng).toHaveBeenCalledTimes(expected.summary.actualPulls)
  })
  it('preserves clear notification with OR across later chunks', async () => {
    const state = initial()
    state.bossHp = 1
    const controller = createBattleController({ initialState: state, rng: seededRng(12), chunkSize: 1, yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 1000 })
    expect(controller.getSnapshot().result?.value.clearedGame).toBe(true)
    expect(controller.getSnapshot().state.stage).toBe(51)
    expect(controller.getSnapshot().result?.value.pendingPulls).toBe(0)
  })
  it('carries NORMAL and CHAIN reservations across multiple bosses', async () => {
    const state = initial(1)
    state.highestStage = 50
    const expected = executeNormalPulls(state, 1000, seededRng(19))
    const controller = createBattleController({ initialState: state, rng: seededRng(19), chunkSize: 13, yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 1000 })
    expect(controller.getSnapshot().state.stage).toBeGreaterThan(3)
    expect(controller.getSnapshot().state).toEqual(expected.state)
    expect(controller.getSnapshot().result?.value).toEqual(expected.summary)
  })
  it('keeps nested CHAIN order across single-pull chunks', async () => {
    const stream = () => {
      const values = [0.99, 0, 0.93, 0.99, 0.4, 0.93]
      let index = 0
      return () => values[index++] ?? 0
    }
    const state = initial(1)
    const expected = executeNormalPulls(state, 10, stream())
    const controller = createBattleController({ initialState: state, rng: stream(), chunkSize: 1, yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 10 })
    expect(expected.summary.chainAdded).toBe(6)
    expect(controller.getSnapshot().state).toEqual(expected.state)
    expect(controller.getSnapshot().result?.value).toEqual(expected.summary)
  })
  it('keeps RNG consumed by a failed chunk advanced rather than rewinding it', async () => {
    const state = initial(1)
    const stream = seededRng(42)
    let calls = 0
    const rng = () => { calls++; const value = stream(); if (calls === 11) throw new Error('mid-chunk'); return value }
    const controller = createBattleController({ initialState: state, rng, chunkSize: 2, yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 10 })
    expect(controller.getSnapshot().result?.value.actualPulls).toBe(2)
    expect(calls).toBe(11)
    const beforeResumeCalls = calls
    await controller.resume()
    expect(calls).toBeGreaterThan(beforeResumeCalls)
    expect(controller.getSnapshot().state.pendingNormalPulls).toBe(0)
    expect(controller.getSnapshot().state.statistics.totalNormalPulls).toBe(10)
  })
  it('rejects rapid competing operations synchronously, before any RNG', async () => {
    let release!: () => void
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ rng, yieldFrame: () => new Promise<void>((resolve) => { release = resolve }) })
    const running = controller.start({ kind: 'normal', count: 1 })
    expect(controller.getSnapshot().busy).toBe(true)
    expect(await controller.start({ kind: 'normal', count: 10 })).toBe(false)
    expect(await controller.start({ kind: 'special', count: 1 })).toBe(false)
    expect(await controller.resume()).toBe(false)
    expect(rng).not.toHaveBeenCalled()
    release(); await running
    expect(rng).toHaveBeenCalledTimes(3)
  })
  it.each(['normal', 'special'] as const)('%s retains the last committed chunk after an error and resumes only the reservation', async (kind) => {
    let fail = true, calls = 0
    const stream = seededRng(41)
    const rng = () => { calls++; if (fail && calls === (kind === 'normal' ? 7 : 3)) throw new Error('test interruption'); return stream() }
    const state = initial(15)
    state.specialGauge = 120
    const controller = createBattleController({ initialState: state, rng, chunkSize: 2, yieldFrame: frame })
    await controller.start(kind === 'normal' ? { kind, count: 10 } : { kind, count: 'MAX' })
    expect(controller.getSnapshot().error).toContain('test interruption')
    expect(controller.getSnapshot().result?.value.actualPulls).toBe(2)
    expect(controller.getSnapshot().state.pendingNormalPulls + controller.getSnapshot().state.pendingSpecialPulls).toBeGreaterThan(0)
    expect(await controller.start({ kind: 'normal', count: 1 })).toBe(false)
    fail = false
    await controller.resume()
    const expected = kind === 'normal' ? executeNormalPulls(state, 10, seededRng(41)) : executeSpecialPulls(state, 'MAX', seededRng(41))
    expect(controller.getSnapshot().state).toEqual(expected.state)
    expect(controller.getSnapshot().result?.value).toEqual(expected.summary)
    expect(controller.getSnapshot().error).toBeNull()
  })
  it('reports first-chunk failure without inventing reservations', async () => {
    const rng = vi.fn(() => NaN)
    const controller = createBattleController({ rng, yieldFrame: frame })
    const before = controller.getSnapshot().state
    expect(await controller.start({ kind: 'normal', count: 10 })).toBe(false)
    expect(controller.getSnapshot().state).toBe(before)
    expect(controller.getSnapshot().error).not.toBeNull()
    expect(await controller.resume()).toBe(false)
  })
  it('cancels on last unsubscribe and allows a fresh subscription to resume', async () => {
    let release!: () => void
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ rng, chunkSize: 1, yieldFrame: () => new Promise<void>((resolve) => { release = resolve }) })
    const stop = controller.subscribe(() => {})
    const running = controller.start({ kind: 'normal', count: 10 })
    release(); await Promise.resolve(); await Promise.resolve()
    expect(controller.getSnapshot().state.pendingNormalPulls).toBe(9)
    stop(); release(); await running
    expect(rng).toHaveBeenCalledTimes(3)
    const stopAgain = controller.subscribe(() => {})
    const resumed = controller.resume()
    for (let i = 0; i < 9; i++) { release(); await Promise.resolve(); await Promise.resolve() }
    await resumed
    expect(controller.getSnapshot().state.pendingNormalPulls).toBe(0)
    expect(rng).toHaveBeenCalledTimes(30)
    stopAgain()
  })
  it('resets summaries between operations and rejects locked core calls without RNG', async () => {
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ rng, yieldFrame: frame })
    await controller.start({ kind: 'normal', count: 1000 })
    expect(rng).not.toHaveBeenCalled()
    await controller.start({ kind: 'normal', count: 10 })
    await controller.start({ kind: 'normal', count: 1 })
    expect(controller.getSnapshot().result?.value.actualPulls).toBe(1)
  })
  it.each([0, -1, 0.5, 501, NaN, Infinity])('rejects invalid UI chunk size %s', (chunkSize) => {
    expect(() => createBattleController({ chunkSize })).toThrow(RangeError)
  })
  it('uses the browser scheduler and cancels pending timers', async () => {
    vi.useFakeTimers()
    try {
      const rng = vi.fn(() => 0)
      const controller = createBattleController({ rng, chunkSize: 1 })
      const stop = controller.subscribe(() => {})
      const running = controller.start({ kind: 'normal', count: 10 })
      await vi.advanceTimersByTimeAsync(16)
      expect(rng).toHaveBeenCalledTimes(3)
      stop(); await running
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(1000)
      expect(rng).toHaveBeenCalledTimes(3)
    } finally { vi.useRealTimers() }
  })
  it('replaces summary kind and has bounded data size', () => {
    const normal = { kind: 'normal' as const, value: executeNormalPulls(initial(), 1, () => 0).summary }
    const special = { kind: 'special' as const, value: executeSpecialPulls(initial(), 1, () => 0).summary }
    expect(mergeSummary(normal, special)).toBe(special)
    expect(JSON.stringify(mergeSummary(normal, normal)).length).toBeLessThan(600)
  })
})

describe('display formatting', () => {
  it.each([NaN, Infinity, -Infinity])('does not present %s as a valid number', (value) => { expect(formatNumber(value)).toBe('—') })
  it('formats fractions and huge numbers without changing values', () => {
    expect(formatNumber(1234.567)).toBe('1,234.57')
    expect(formatNumber(1e12)).toBe('1.00e+12')
    expect(formatNumber(0)).toBe('0')
  })
})
