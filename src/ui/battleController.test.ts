import { describe, expect, it, vi } from 'vitest'
import { calculateBossMaxHp } from '../game/boss'
import { createInitialGameState, executeNormalPulls, executeSpecialPulls, resumePendingNormalPulls } from '../game/engine'
import { seededRng } from '../test/random'
import { createBattleController, mergeSummary, UI_AUTO_PULL_LIMIT } from './battleController'
import { formatNumber } from './format'

const frame = async () => {}
function initial(stage = 50) {
  return { ...createInitialGameState(), stage, highestStage: stage, bossHp: calculateBossMaxHp(stage), specialGauge: 60_000 }
}

describe('UI chunk execution', () => {
  it('pauses long CHAIN at 10,000, preserves FIFO and RNG, and caps each manual resume', async () => {
    const stream = () => {
      let index = 0
      return () => { const position = index++; return position < 30_000 && position % 3 === 2 ? 0.93 : 0 }
    }
    const state = initial(1)
    const expectedRng = stream()
    const first = executeNormalPulls(state, 1, expectedRng, UI_AUTO_PULL_LIMIT)
    const rng = vi.fn(stream())
    // A non-divisor verifies the final chunk is shortened to exactly the budget.
    const controller = createBattleController({ initialState: state, rng, chunkSize: 333, yieldFrame: frame })
    expect(await controller.start({ kind: 'normal', count: 1 })).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({ busy: false, paused: true, error: null, state: first.state })
    expect(controller.getSnapshot().result).toEqual({ kind: 'normal', value: first.summary })
    expect(first.state.pendingNormalPulls).toBe(20_001)
    expect(rng).toHaveBeenCalledTimes(30_000)
    const pausedSnapshot = controller.getSnapshot()
    expect(controller.getSnapshot()).toBe(pausedSnapshot)
    expect(await controller.start({ kind: 'special', count: 1 })).toBe(false)
    expect(controller.getSnapshot()).toBe(pausedSnapshot)
    let expectedState = first.state
    let expectedSummary = { kind: 'normal' as const, value: first.summary }
    for (const total of [20_000, 30_000, 30_001]) {
      const next = resumePendingNormalPulls(expectedState, expectedRng, UI_AUTO_PULL_LIMIT)
      expectedState = next.state
      expectedSummary = mergeSummary(expectedSummary, { kind: 'normal', value: next.summary }) as typeof expectedSummary
      expect(await controller.resume()).toBe(true)
      expect(controller.getSnapshot().state).toEqual(expectedState)
      expect(controller.getSnapshot().result).toEqual(expectedSummary)
      expect(controller.getSnapshot()).toMatchObject({ busy: false, paused: total < 30_001, error: null })
      expect(rng).toHaveBeenCalledTimes(total * 3)
    }
    expect(controller.getSnapshot().state.pendingNormalPulls).toBe(0)
    expect(controller.getSnapshot().state).toEqual(executeNormalPulls(state, 1, stream()).state)
  })
  it('caps huge SPECIAL MAX and preserves the fixed reservation through repeated resume', async () => {
    const state = initial()
    state.specialGauge = 20_001 * 30
    const expected = executeSpecialPulls(state, 'MAX', () => 0)
    const rng = vi.fn(() => 0)
    const controller = createBattleController({ initialState: state, rng, yieldFrame: frame })
    await controller.start({ kind: 'special', count: 'MAX' })
    expect(controller.getSnapshot()).toMatchObject({ busy: false, paused: true, error: null })
    expect(controller.getSnapshot().state.pendingSpecialPulls).toBe(10_001)
    expect(rng).toHaveBeenCalledTimes(10_000)
    await controller.resume()
    expect(controller.getSnapshot().paused).toBe(true)
    expect(controller.getSnapshot().state.pendingSpecialPulls).toBe(1)
    await controller.resume()
    expect(controller.getSnapshot().paused).toBe(false)
    expect(controller.getSnapshot().state).toEqual(expected.state)
    expect(controller.getSnapshot().result).toEqual({ kind: 'special', value: expected.summary })
    expect(rng).toHaveBeenCalledTimes(20_001)
  })
  it('completes at the exact safety boundary when no reservation remains', async () => {
    const state = initial()
    state.specialGauge = UI_AUTO_PULL_LIMIT * 30
    const controller = createBattleController({ initialState: state, rng: () => 0, yieldFrame: frame })
    await controller.start({ kind: 'special', count: 'MAX' })
    expect(controller.getSnapshot()).toMatchObject({ busy: false, paused: false, error: null })
    expect(controller.getSnapshot().state.pendingSpecialPulls).toBe(0)
  })
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
