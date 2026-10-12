// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createInitialGameState, executeNormalPulls, executeSpecialPulls, resumePendingNormalPulls, resumePendingSpecialPulls } from '../game/engine'
import { calculateBossMaxHp } from '../game/boss'
import { createBattleController } from '../ui/battleController'
import type { SaveDataV1 } from '../types/game'
import { createAutosave, SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS } from './autosave'
import { createBrowserSession } from './browserSession'
import { openLocalSave, SAVE_STORAGE_KEY } from './localSave'
import { createCheckpointRandom } from './random'
import { deserializeSaveData, serializeSaveData } from './saveCodec'

const lifecycle = { window, document }
const frame = async () => {}
const seed = { algorithm: 'mulberry32-v1' as const, state: 0x12345678 }
function save(state = createInitialGameState()): SaveDataV1 {
  return { saveVersion: 1, state, settings: { reducedEffects: false }, rng: seed }
}
function memory(raw: string | null = null) {
  let value = raw
  return { getItem: vi.fn(() => value), setItem: vi.fn((_key: string, next: string) => { value = next }),
    external: (next: string | null) => { value = next } }
}
function setup(initial = save(), raw: string | null = serializeSaveData(initial)) {
  const storage = memory(raw)
  const adapter = openLocalSave(() => storage)
  const rng = createCheckpointRandom(initial.rng)
  const controller = createBattleController({ initialState: initial.state, settings: initial.settings, checkpointRandom: rng, yieldFrame: frame })
  const persistence = createAutosave(controller, adapter, lifecycle)
  return { storage, adapter, rng, controller, persistence }
}
const cleanups: (() => void)[] = []
afterEach(() => { cleanup(); cleanups.splice(0).forEach(fn => fn()); vi.useRealTimers(); localStorage.clear() })

describe('localStorage safety adapter', () => {
  it('distinguishes no save from a validated detached restored save', () => {
    const fresh = openLocalSave(() => memory())
    expect(fresh.data).toBeNull()
    expect(fresh.getBlockedReason()).toBeNull()
    const original = save()
    expect(openLocalSave(() => memory(serializeSaveData(original))).data).toEqual(original)
  })

  it.each(['{', '{"saveVersion":2}', JSON.stringify({ ...save(), state: { ...save().state, bossHp: 0 } })])('keeps invalid original data %s', raw => {
    const storage = memory(raw)
    const adapter = openLocalSave(() => storage)
    expect(adapter.data).toBeNull()
    expect(adapter.getBlockedReason()).toMatch(/読み込めません/)
    expect(() => adapter.write(save())).toThrow()
    expect(storage.getItem()).toBe(raw)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it.each(['getter', 'read'])('blocks saving when storage %s is denied', mode => {
    const adapter = openLocalSave(() => {
      if (mode === 'getter') throw new DOMException('denied', 'SecurityError')
      return { getItem: () => { throw new DOMException('denied', 'SecurityError') }, setItem: vi.fn() }
    })
    expect(adapter.getBlockedReason()).toMatch(/保存を停止/)
    expect(() => adapter.write(save())).toThrow()
  })

  it('never writes a checkpoint that fails codec validation', () => {
    const storage = memory()
    const adapter = openLocalSave(() => storage)
    expect(() => adapter.write({ ...save(), state: { ...save().state, bossHp: 0 } })).toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('detects an external write even before a storage event arrives', () => {
    const storage = memory()
    const adapter = openLocalSave(() => storage)
    storage.external('other tab')
    expect(() => adapter.write(save())).toThrow(/別のタブ/)
    expect(storage.getItem()).toBe('other tab')
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})

describe('debounce, checkpoints and lifecycle', () => {
  it('saves the latest committed state after debounce, never on busy/summary-only updates', async () => {
    vi.useFakeTimers()
    const { controller, persistence, storage } = setup(save(), null)
    cleanups.push(persistence.connect())
    expect(persistence.getSnapshot().kind).toBe('pending')
    await controller.start({ kind: 'normal', count: 10 })
    expect(storage.setItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1)
    expect(storage.setItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(deserializeSaveData(storage.getItem()!)).toEqual(controller.getCheckpoint())
    expect(persistence.getSnapshot().kind).toBe('saved')
  })

  it('does not postpone a long operation beyond maximum wait', async () => {
    vi.useFakeTimers()
    const { controller, persistence, storage } = setup()
    cleanups.push(persistence.connect())
    for (let i = 0; i < SAVE_MAX_WAIT_MS / 100; i++) {
      await controller.start({ kind: 'normal', count: 1 })
      vi.advanceTimersByTime(100)
    }
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(deserializeSaveData(storage.getItem()!)).toEqual(controller.getCheckpoint())
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['pagehide', 'visibilitychange'])('flushes on %s', async event => {
    vi.useFakeTimers()
    const { controller, persistence, storage } = setup()
    cleanups.push(persistence.connect())
    await controller.start({ kind: 'normal', count: 1 })
    if (event === 'pagehide') window.dispatchEvent(new Event(event))
    else {
      const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      document.dispatchEvent(new Event(event))
      spy.mockRestore()
    }
    expect(deserializeSaveData(storage.getItem()!)).toEqual(controller.getCheckpoint())
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['QuotaExceededError', 'SecurityError'])('reports %s writes without losing state and retries a later flush', async name => {
    const { controller, persistence, storage } = setup()
    cleanups.push(persistence.connect())
    await controller.start({ kind: 'normal', count: 1 })
    const checkpoint = controller.getCheckpoint()
    storage.setItem.mockImplementationOnce(() => { throw new DOMException('storage failure', name) })
    persistence.flush()
    expect(persistence.getSnapshot()).toMatchObject({ kind: 'error', message: expect.stringMatching(/保存失敗/) })
    expect(controller.getCheckpoint()).toBe(checkpoint)
    expect(deserializeSaveData(storage.getItem()!)).toEqual(save())
    persistence.flush()
    expect(persistence.getSnapshot().kind).toBe('saved')
    expect(deserializeSaveData(storage.getItem()!)).toEqual(checkpoint)
  })

  it.each([SAVE_STORAGE_KEY, null])('stops timers and preserves external data on storage event %s', key => {
    vi.useFakeTimers()
    const { controller, persistence, storage } = setup()
    cleanups.push(persistence.connect())
    controller.setReducedEffects(true)
    storage.external('external')
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: 'external' }))
    expect(persistence.getSnapshot().kind).toBe('blocked')
    vi.runAllTimers()
    persistence.flush()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.getItem()).toBe('external')
  })

  it('ignores unrelated storage keys and matching raw content', () => {
    const { persistence, storage } = setup()
    cleanups.push(persistence.connect())
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'other' }))
    window.dispatchEvent(new StorageEvent('storage', { key: SAVE_STORAGE_KEY, newValue: storage.getItem() }))
    expect(persistence.getSnapshot().kind).toBe('saved')
  })

  it('ignores another storage area, even when it uses the same key', () => {
    const { persistence } = setup()
    cleanups.push(persistence.connect())
    window.dispatchEvent(new StorageEvent('storage', { key: SAVE_STORAGE_KEY, newValue: 'different', storageArea: sessionStorage }))
    expect(persistence.getSnapshot().kind).toBe('saved')
  })

  it('checkpoint saves during a still-busy operation and includes settings without touching RNG', async () => {
    vi.useFakeTimers()
    const rng = createCheckpointRandom(seed)
    const controller = createBattleController({ initialState: { ...createInitialGameState(), pendingNormalPulls: 5000, normalPullQueue: { base: 4990, chain: 10 } },
      checkpointRandom: rng, yieldFrame: () => new Promise(resolve => setTimeout(resolve, 100)) })
    const storage = memory()
    const persistence = createAutosave(controller, openLocalSave(() => storage), lifecycle)
    const disconnect = persistence.connect()
    const running = controller.resume()
    await vi.advanceTimersByTimeAsync(900)
    expect(controller.getSnapshot().busy).toBe(true)
    const state = controller.getSnapshot().state
    const checkpointRng = controller.getCheckpoint()!.rng
    controller.setReducedEffects(true)
    expect(controller.getSnapshot().state).toBe(state)
    expect(controller.getCheckpoint()!.rng).toBe(checkpointRng)
    await vi.advanceTimersByTimeAsync(1100)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    const saved = deserializeSaveData(storage.getItem()!)
    expect(saved.state.pendingNormalPulls).toBeGreaterThan(0)
    expect(saved.settings.reducedEffects).toBe(true)
    expect(controller.getSnapshot().busy).toBe(true)
    disconnect()
    await vi.runAllTimersAsync()
    await running
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the last successful RNG on failed chunks, settings and delayed saves', async () => {
    const initial = save()
    const rng = createCheckpointRandom(initial.rng)
    let calls = 0
    let goodRng = initial.rng
    const random = () => {
      const value = rng.random()
      calls++
      if (calls === 3) goodRng = rng.getCheckpoint()
      if (calls === 5) throw new Error('failed chunk after RNG advancement')
      return value
    }
    const controller = createBattleController({ checkpointRandom: { random, getCheckpoint: rng.getCheckpoint }, chunkSize: 1, yieldFrame: frame })
    const storage = memory()
    const persistence = createAutosave(controller, openLocalSave(() => storage), lifecycle)
    cleanups.push(persistence.connect())
    expect(await controller.start({ kind: 'normal', count: 10 })).toBe(false)
    expect(controller.getCheckpoint()!.rng).toEqual(goodRng)
    expect(rng.getCheckpoint()).not.toEqual(goodRng)
    const state = controller.getSnapshot().state
    controller.setReducedEffects(true)
    expect(controller.getSnapshot().state).toBe(state)
    persistence.flush()
    const restored = deserializeSaveData(storage.getItem()!)
    expect(restored.rng).toEqual(goodRng)
    expect(restored.state).toEqual(state)
    expect(restored.settings.reducedEffects).toBe(true)
    expect(restored.state.pendingNormalPulls).toBeGreaterThan(0)
  })

  it('does not update any checkpoint on a first-chunk failure', async () => {
    const rng = createCheckpointRandom(seed)
    const controller = createBattleController({ checkpointRandom: { random: () => { rng.random(); throw new Error('failure') }, getCheckpoint: rng.getCheckpoint }, yieldFrame: frame })
    const checkpoint = controller.getCheckpoint()
    await controller.start({ kind: 'normal', count: 1 })
    expect(controller.getCheckpoint()).toBe(checkpoint)
    expect(rng.getCheckpoint()).not.toEqual(checkpoint!.rng)
  })
})

describe('restore and manual queue continuation', () => {
  it('restores legitimate purchases, RESPEC, Focus, settings and statistics', async () => {
    const { controller, persistence, storage } = setup(save(), null)
    cleanups.push(persistence.connect())
    while (controller.getSnapshot().state.stage < 8) await controller.start({ kind: 'normal', count: 10 })
    for (const upgrade of ['PULL_POWER', 'RESONANCE_POWER', 'SPECIAL_POWER'] as const) {
      expect(controller.purchase(upgrade, controller.getSnapshot().state)).toBe(true)
    }
    expect(controller.changeFocus('FIRE_WIND', controller.getSnapshot().state)).toBe(true)
    controller.setReducedEffects(true)
    persistence.flush()
    const restored = openLocalSave(() => storage).data!
    expect(restored).toEqual(controller.getCheckpoint())
    expect(restored.state.upgradeLevels).toEqual({ PULL_POWER: 1, RESONANCE_POWER: 1, SPECIAL_POWER: 1 })
    expect(controller.respec(controller.getSnapshot().state)).toBe(true)
    persistence.flush()
    expect(openLocalSave(() => storage).data).toEqual(controller.getCheckpoint())
    expect(controller.getCheckpoint()!.state.spentShards).toEqual({ PULL_POWER: 0, RESONANCE_POWER: 0, SPECIAL_POWER: 0 })
  })

  it('restores real base and CHAIN reservations without auto-executing or replaying highlights', async () => {
    let initial = save()
    for (let state = 0; state < 1000; state++) {
      const rng = createCheckpointRandom({ algorithm: 'mulberry32-v1', state })
      const first = executeNormalPulls(createInitialGameState(), 10, rng.random, 1)
      if (first.state.normalPullQueue.chain) { initial = { ...initial, state: first.state, rng: rng.getCheckpoint() }; break }
    }
    expect(initial.state.normalPullQueue.chain).toBe(3)
    const { controller, persistence } = setup(initial)
    cleanups.push(persistence.connect())
    expect(controller.getSnapshot()).toMatchObject({ busy: false, result: null, highlight: null, state: initial.state })
    expect(await controller.start({ kind: 'normal', count: 1 })).toBe(false)
    expect(controller.purchase('PULL_POWER', controller.getSnapshot().state)).toBe(false)
    const expectedRng = createCheckpointRandom(initial.rng)
    const expected = resumePendingNormalPulls(initial.state, expectedRng.random)
    expect(await controller.resume()).toBe(true)
    expect(controller.getCheckpoint()!.state).toEqual(expected.state)
    expect(controller.getCheckpoint()!.rng).toEqual(expectedRng.getCheckpoint())
    expect(controller.getSnapshot().highlight?.result).toEqual({ kind: 'normal', value: expected.summary })
  })

  it.each(['normal', 'special'] as const)('restores 10,000-cap %s continuation with identical state and RNG', async kind => {
    const initial = save({ ...createInitialGameState(), stage: 50, highestStage: 50, bossHp: calculateBossMaxHp(50), specialGauge: 600_030,
      statistics: { ...createInitialGameState().statistics, totalNormalPulls: 49, bossesDefeated: 49 } })
    if (kind === 'normal') {
      initial.state.pendingNormalPulls = 10_010
      initial.state.normalPullQueue = { base: 10_000, chain: 10 }
    }
    const { controller, persistence, storage } = setup(initial)
    cleanups.push(persistence.connect())
    if (kind === 'normal') await controller.resume()
    else await controller.start({ kind: 'special', count: 'MAX' })
    expect(controller.getSnapshot().paused).toBe(true)
    expect(controller.getSnapshot().result!.value.actualPulls).toBe(10_000)
    persistence.flush()
    const restored = openLocalSave(() => storage).data!
    const rng = createCheckpointRandom(restored.rng)
    const next = createBattleController({ initialState: restored.state, settings: restored.settings, checkpointRandom: rng, yieldFrame: frame })
    expect(next.getSnapshot().highlight).toBeNull()
    await controller.resume()
    await next.resume()
    expect(next.getCheckpoint()).toEqual(controller.getCheckpoint())
  })

  it('SPECIAL MAX keeps its original fixed count after a partial checkpoint', async () => {
    const state = { ...createInitialGameState(), stage: 10, highestStage: 10, bossHp: calculateBossMaxHp(10), specialGauge: 307,
      statistics: { ...createInitialGameState().statistics, totalNormalPulls: 9, bossesDefeated: 9 } }
    const rng = createCheckpointRandom(seed)
    const partial = executeSpecialPulls(state, 'MAX', rng.random, 2)
    const initial = { ...save(partial.state), rng: rng.getCheckpoint() }
    expect(partial.state.pendingSpecialPulls).toBe(8)
    const { controller } = setup(initial)
    const expectedRng = createCheckpointRandom(initial.rng)
    const expected = resumePendingSpecialPulls(initial.state, expectedRng.random)
    await controller.resume()
    expect(controller.getSnapshot().state).toEqual(expected.state)
    expect(controller.getCheckpoint()!.rng).toEqual(expectedRng.getCheckpoint())
    expect(controller.getSnapshot().state.specialGauge).toBe(7)
  })
})

describe('React and startup integration', () => {
  it('loads all data before rendering and does not consume RNG in StrictMode render/settings', async () => {
    vi.useFakeTimers()
    const saved = save()
    saved.settings.reducedEffects = true
    localStorage.setItem(SAVE_STORAGE_KEY, serializeSaveData(saved))
    const session = createBrowserSession()
    const checkpoint = session.controller.getCheckpoint()
    const view = render(<StrictMode><App {...session} /></StrictMode>)
    expect((screen.getByRole('checkbox', { name: '演出軽減' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByLabelText('保存状態').textContent).toMatch(/復元しました/)
    expect(session.controller.getCheckpoint()).toBe(checkpoint)
    fireEvent.click(screen.getByRole('checkbox', { name: '演出軽減' }))
    expect(session.controller.getCheckpoint()!.rng).toEqual(saved.rng)
    expect(session.controller.getSnapshot().state).toBe(checkpoint!.state)
    act(() => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS) })
    expect(deserializeSaveData(localStorage.getItem(SAVE_STORAGE_KEY)!).settings.reducedEffects).toBe(false)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('StrictMode/unmount flushes once, removes timers/listeners and cancels pending work', async () => {
    vi.useFakeTimers()
    const { controller, persistence, storage } = setup(save(), null)
    const view = render(<StrictMode><App controller={controller} persistence={persistence} /></StrictMode>)
    await act(async () => { await controller.start({ kind: 'normal', count: 10 }) })
    view.unmount()
    const writes = storage.setItem.mock.calls.length
    expect(deserializeSaveData(storage.getItem()!)).toEqual(controller.getCheckpoint())
    expect(vi.getTimerCount()).toBe(0)
    window.dispatchEvent(new Event('pagehide'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new StorageEvent('storage', { key: SAVE_STORAGE_KEY, newValue: 'outside' }))
    expect(storage.setItem).toHaveBeenCalledTimes(writes)
  })

  it('unmount during the first frame stops pulls and saves only the initial checkpoint', async () => {
    vi.useFakeTimers()
    const session = createBrowserSession()
    const initial = session.controller.getCheckpoint()
    const view = render(<StrictMode><App {...session} /></StrictMode>)
    fireEvent.click(screen.getByRole('button', { name: 'NORMAL ×10' }))
    expect(session.controller.getSnapshot().busy).toBe(true)
    view.unmount()
    await act(async () => { await vi.runAllTimersAsync() })
    expect(session.controller.getCheckpoint()).toBe(initial)
    expect(session.controller.getSnapshot().busy).toBe(false)
    expect(deserializeSaveData(localStorage.getItem(SAVE_STORAGE_KEY)!)).toEqual(initial)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows clear achievement after restore without past result/first-clear animation', () => {
    const state = { ...createInitialGameState(), stage: 51, highestStage: 51, bossHp: calculateBossMaxHp(51),
      statistics: { ...createInitialGameState().statistics, totalNormalPulls: 100, ssrCount: 3, bossesDefeated: 50, jackpotCount: 1 } }
    const { controller, persistence } = setup(save(state))
    render(<StrictMode><App controller={controller} persistence={persistence} /></StrictMode>)
    expect(screen.getByText(/Stage 50 クリア済み/)).toBeTruthy()
    expect(screen.getByLabelText('結果ハイライト').textContent).toBe('')
    expect(controller.getSnapshot()).toMatchObject({ highlight: null, result: null, busy: false })
  })

  it('starts a playable unsaved game with a clear warning while preserving corrupt storage', async () => {
    localStorage.setItem(SAVE_STORAGE_KEY, '{broken')
    const session = createBrowserSession()
    const view = render(<App {...session} />)
    expect(screen.getByLabelText('保存状態').textContent).toMatch(/読み込めません/)
    await act(async () => { await session.controller.start({ kind: 'normal', count: 1 }) })
    session.persistence.flush()
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBe('{broken')
    expect(session.controller.getSnapshot().state.statistics.totalNormalPulls).toBeGreaterThan(0)
    view.unmount()
  })
})
