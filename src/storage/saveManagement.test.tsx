// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { calculateBossMaxHp } from '../game/boss'
import { createInitialGameState } from '../game/engine'
import { createBattleController } from '../ui/battleController'
import { createAutosave } from './autosave'
import { createBrowserSession } from './browserSession'
import { openLocalSave, SAVE_STORAGE_KEY } from './localSave'
import { createCheckpointRandom } from './random'
import { deserializeSaveData, MAX_SAVE_JSON_LENGTH, serializeSaveData } from './saveCodec'
import { createSaveManagement, downloadSave, MAX_IMPORT_BYTES } from './saveManagement'
import type { SaveDataV1 } from '../types/game'

const initial = (): SaveDataV1 => ({ saveVersion: 1, state: createInitialGameState(),
  settings: { reducedEffects: false }, rng: { algorithm: 'mulberry32-v1', state: 12345678 } })
const file = (json = serializeSaveData(initial())) => ({ size: new Blob([json]).size, text: vi.fn(async () => json) })
const frame = async () => {}
const stops: (() => void)[] = []
function setup(raw: string | null = serializeSaveData(initial()), data = initial()) {
  let stored = raw
  const storage = { getItem: vi.fn(() => stored), setItem: vi.fn((_key: string, value: string) => { stored = value }),
    removeItem: vi.fn(() => { stored = null }), external: (value: string | null) => { stored = value } }
  const adapter = openLocalSave(() => storage)
  const controller = createBattleController({ initialState: data.state, settings: data.settings,
    checkpointRandom: createCheckpointRandom(data.rng), yieldFrame: frame })
  const persistence = createAutosave(controller, adapter, { window, document })
  const reload = vi.fn()
  const management = createSaveManagement(controller, persistence, () => storage, reload)
  stops.push(persistence.connect())
  return { storage, controller, persistence, management, reload }
}
const modal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
})
afterAll(() => {
  if (modal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', modal)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})
afterEach(() => { cleanup(); stops.splice(0).forEach(stop => stop()); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear() })

describe('validated export and import preparation', () => {
  it('exports the latest committed checkpoint without a storage write, even if blocked', async () => {
    const session = setup('{broken')
    await session.controller.start({ kind: 'normal', count: 10 })
    expect(deserializeSaveData(session.management.exportCurrent())).toEqual(session.controller.getCheckpoint())
    expect(session.storage.getItem()).toBe('{broken')
    expect(session.storage.setItem).not.toHaveBeenCalled()
    expect(session.management.backupRaw()).toBe('{broken')
  })
  it.each(['{', '{"saveVersion":999}', 'unvalidated original'])('backs up exact unvalidated raw %s', raw => {
    const { management, storage } = setup(raw)
    expect(management.backupRaw()).toBe(raw)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('reports unavailable raw when there is no stored data', () => {
    expect(() => setup(null).management.backupRaw()).toThrow(/ありません/)
  })
  it('validates a detached preview without changing state, RNG or storage', async () => {
    const { controller, storage, management } = setup()
    const before = controller.getCheckpoint()
    const imported = { ...initial(), settings: { reducedEffects: true } }
    const preview = await management.prepareImport(file(serializeSaveData(imported)))
    expect(preview.data).toEqual(imported)
    expect(controller.getCheckpoint()).toBe(before)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
  it.each([-1, NaN, Infinity, MAX_IMPORT_BYTES + 1])('rejects size %s before reading', async size => {
    const item = { ...file(), size }
    await expect(setup().management.prepareImport(item)).rejects.toMatchObject({ code: 'SIZE' })
    expect(item.text).not.toHaveBeenCalled()
  })
  it('accepts the byte boundary, with a valid JSON under the character boundary', async () => {
    await expect(setup().management.prepareImport({ ...file(), size: MAX_IMPORT_BYTES })).resolves.toBeTruthy()
  })
  it.each([
    ['{', 'SYNTAX'], ['{"saveVersion":2}', 'VERSION'],
    [' '.repeat(MAX_SAVE_JSON_LENGTH + 1), 'SIZE'],
    [JSON.stringify({ ...initial(), extra: true }), 'SCHEMA'],
    [JSON.stringify({ ...initial(), rng: { algorithm: 'unknown', state: 0 } }), 'STATE'],
    [JSON.stringify({ ...initial(), state: { ...initial().state, spentShards: { PULL_POWER: 14, RESONANCE_POWER: 0, SPECIAL_POWER: 0 } } }), 'STATE'],
  ])('rejects invalid JSON without mutation (%s)', async (json, code) => {
    const { controller, management, storage } = setup()
    const checkpoint = controller.getCheckpoint()
    await expect(management.prepareImport(file(json))).rejects.toMatchObject({ code })
    expect(controller.getCheckpoint()).toBe(checkpoint)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('reports file read errors', async () => {
    await expect(setup().management.prepareImport({ size: 1, text: async () => { throw Error('read') } })).rejects.toThrow(/ファイルを読み込めません/)
  })
  it('rejects changed state during asynchronous file reading', async () => {
    const { management, controller } = setup()
    let finish!: (value: string) => void
    const pending = management.prepareImport({ size: 1, text: () => new Promise(resolve => { finish = resolve }) })
    controller.setReducedEffects(true)
    finish(serializeSaveData(initial()))
    await expect(pending).rejects.toThrow(/読込中に状態/)
  })
})

describe('confirmed replacement versus old autosave', () => {
  it.each(['import', 'delete'] as const)('cannot flush even during the synchronous %s storage call', async kind => {
    const { controller, storage, persistence, management } = setup()
    await controller.start({ kind: 'normal', count: 1 })
    const token = kind === 'import' ? await management.prepareImport(file()) : management.prepareDelete()
    const duringWrite = () => {
      window.dispatchEvent(new Event('pagehide'))
      persistence.flush()
      expect(storage.setItem).toHaveBeenCalledTimes(kind === 'import' ? 1 : 0)
    }
    if (kind === 'import') storage.setItem.mockImplementationOnce((_key, json) => { duringWrite(); storage.external(json) })
    else storage.removeItem.mockImplementationOnce(() => { duringWrite(); storage.external(null) })
    management.confirm(token)
    expect(storage.getItem()).toBe(kind === 'import' ? serializeSaveData(initial()) : null)
  })
  it.each(['import', 'delete'] as const)('retires timers, listeners and old cleanup after %s', async kind => {
    vi.useFakeTimers()
    const { controller, storage, persistence, management, reload } = setup()
    await controller.start({ kind: 'normal', count: 1 }) // pending debounce
    const target = { ...initial(), settings: { reducedEffects: true } }
    const preview = kind === 'import' ? await management.prepareImport(file(serializeSaveData(target))) : management.prepareDelete()
    management.confirm(preview)
    expect(reload).toHaveBeenCalledTimes(1)
    const expected = kind === 'import' ? serializeSaveData(target) : null
    expect(storage.getItem()).toBe(expected)
    window.dispatchEvent(new Event('pagehide'))
    document.dispatchEvent(new Event('visibilitychange'))
    persistence.flush(); persistence.resume(); persistence.connect()()
    stops.splice(0).forEach(stop => stop())
    vi.runAllTimers()
    expect(storage.getItem()).toBe(expected)
    expect(vi.getTimerCount()).toBe(0)
    expect(() => management.confirm(preview)).toThrow()
    expect(reload).toHaveBeenCalledTimes(1)
    if (kind === 'delete') expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith(SAVE_STORAGE_KEY)
  })
  it.each(['import', 'delete'] as const)('retains raw and live state on %s I/O failure then resumes saves', async kind => {
    vi.useFakeTimers()
    const { controller, storage, persistence, management, reload } = setup()
    await controller.start({ kind: 'normal', count: 1 })
    const checkpoint = controller.getCheckpoint()
    const raw = storage.getItem()
    const preview = kind === 'import' ? await management.prepareImport(file()) : management.prepareDelete()
    const method = kind === 'import' ? storage.setItem : storage.removeItem
    method.mockImplementationOnce(() => { throw new DOMException('denied', 'QuotaExceededError') })
    expect(() => management.confirm(preview)).toThrow('denied')
    expect(storage.getItem()).toBe(raw)
    expect(controller.getCheckpoint()).toBe(checkpoint)
    expect(reload).not.toHaveBeenCalled()
    persistence.flush()
    expect(deserializeSaveData(storage.getItem()!)).toEqual(checkpoint)
  })
  it.each(['import', 'delete'] as const)('rejects another tab changing raw before %s', async kind => {
    const { controller, storage, persistence, management, reload } = setup()
    const preview = kind === 'import' ? await management.prepareImport(file()) : management.prepareDelete()
    storage.external('another tab')
    expect(() => management.confirm(preview)).toThrow(/保存データが変更/)
    controller.setReducedEffects(true)
    persistence.flush()
    expect(storage.getItem()).toBe('another tab')
    expect(reload).not.toHaveBeenCalled()
  })
  it.each(['{broken', '{"saveVersion":99}', 'external'])('permits explicit confirmed recovery of %s', async raw => {
    const { storage, management } = setup(raw)
    const preview = await management.prepareImport(file())
    management.confirm(preview)
    expect(deserializeSaveData(storage.getItem()!)).toEqual(initial())
  })
  it('permits confirmed deletion of protected corrupt data', () => {
    const { management, storage } = setup('{broken')
    management.confirm(management.prepareDelete())
    expect(storage.getItem()).toBeNull()
  })
  it('recovers after an actual external storage event using a freshly confirmed raw', async () => {
    const { storage, persistence, management } = setup()
    const external = serializeSaveData({ ...initial(), settings: { reducedEffects: true } })
    storage.external(external)
    window.dispatchEvent(new StorageEvent('storage', { key: SAVE_STORAGE_KEY, newValue: external }))
    expect(persistence.getSnapshot().kind).toBe('blocked')
    management.confirm(await management.prepareImport(file()))
    expect(deserializeSaveData(storage.getItem()!)).toEqual(initial())
  })
  it('requires renewed confirmation if normal autosave changed raw while the dialog was open', async () => {
    vi.useFakeTimers()
    const { controller, persistence, management, storage } = setup()
    await controller.start({ kind: 'normal', count: 1 })
    const token = management.prepareDelete()
    persistence.flush()
    const saved = storage.getItem()
    expect(() => management.confirm(token)).toThrow(/保存データが変更/)
    expect(storage.getItem()).toBe(saved)
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
  it('rejects stale confirmation after a setting update', () => {
    const { management, controller, storage } = setup()
    const preview = management.prepareDelete()
    controller.setReducedEffects(true)
    expect(() => management.confirm(preview)).toThrow(/状態が変わりました/)
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
  it('rejects operations while busy and foreign confirmation objects', async () => {
    const { management, controller } = setup()
    const running = controller.start({ kind: 'normal', count: 10 })
    expect(() => management.exportCurrent()).toThrow(/PULL処理中/)
    expect(() => management.prepareDelete()).toThrow(/PULL処理中/)
    await expect(management.prepareImport(file())).rejects.toThrow(/PULL処理中/)
    await running
    expect(() => management.confirm({ ...management.prepareDelete() })).toThrow()
  })
  it('keeps private imported data safe from preview mutation', async () => {
    const { management, storage } = setup()
    const preview = await management.prepareImport(file())
    preview.data!.state.resonanceShards = 1
    management.confirm(preview)
    expect(deserializeSaveData(storage.getItem()!).state.resonanceShards).toBe(0)
  })
  it('reports storage access refusal without any successful replacement', async () => {
    const session = setup()
    const manager = createSaveManagement(session.controller, session.persistence, () => { throw Error('access denied') }, session.reload)
    expect(() => manager.backupRaw()).toThrow('access denied')
    expect(() => manager.prepareDelete()).toThrow('access denied')
    await expect(manager.prepareImport(file())).rejects.toThrow('access denied')
    expect(session.reload).not.toHaveBeenCalled()
  })
})

describe('real session round trip', () => {
  it.each(['normal', 'special'] as const)('exports/deletes/imports/reloads pending %s and resumes identical RNG/results', async kind => {
    const data = initial()
    data.state = { ...data.state, stage: 51, highestStage: 51, bossHp: calculateBossMaxHp(51), specialGauge: 307,
      statistics: { ...data.state.statistics, totalNormalPulls: 50, bossesDefeated: 50 } }
    data.settings.reducedEffects = true
    if (kind === 'normal') { data.state.pendingNormalPulls = 203; data.state.normalPullQueue = { base: 200, chain: 3 } }
    else data.state.pendingSpecialPulls = 10
    localStorage.setItem(SAVE_STORAGE_KEY, serializeSaveData(data))
    localStorage.setItem('other-key', 'untouched')
    const first = createBrowserSession()
    stops.push(first.persistence.connect())
    const backup = first.management.exportCurrent()
    first.management = createSaveManagement(first.controller, first.persistence, () => localStorage, vi.fn())
    first.management.confirm(first.management.prepareDelete())
    expect(localStorage.getItem(SAVE_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem('other-key')).toBe('untouched')
    const fresh = createBrowserSession()
    stops.push(fresh.persistence.connect())
    const manager = createSaveManagement(fresh.controller, fresh.persistence, () => localStorage, vi.fn())
    manager.confirm(await manager.prepareImport(file(backup)))
    const restored = createBrowserSession()
    stops.push(restored.persistence.connect())
    expect(restored.controller.getCheckpoint()).toEqual(data)
    expect(restored.controller.getSnapshot()).toMatchObject({ result: null, highlight: null, busy: false })
    await first.controller.resume()
    await restored.controller.resume()
    expect(restored.controller.getCheckpoint()).toEqual(first.controller.getCheckpoint())
    expect(restored.controller.getSnapshot().highlight?.result.value.clearedGame).toBe(false)
  })
})

describe('save management UI', () => {
  it('confirms delete under StrictMode, cancels/Esc without writes and restores focus', () => {
    const session = setup()
    render(<StrictMode><App {...session} /></StrictMode>)
    const opener = screen.getByRole('button', { name: 'セーブを削除して最初から' })
    opener.focus(); fireEvent.click(opener)
    expect(within(screen.getByRole('dialog')).getByText(/元に戻せません/)).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(session.storage.removeItem).not.toHaveBeenCalled()
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(session.storage.removeItem).not.toHaveBeenCalled()
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: '削除して最初から' }))
    expect(session.storage.removeItem).toHaveBeenCalledTimes(1)
    expect(session.reload).toHaveBeenCalledTimes(1)
  })
  it('previews a validated file, cancels unchanged, then confirms once', async () => {
    const session = setup()
    render(<StrictMode><App {...session} /></StrictMode>)
    const input = screen.getByLabelText(/JSONファイルをImport/)
    fireEvent.change(input, { target: { files: [file()] } })
    await screen.findByRole('dialog')
    expect(screen.getByText('Importする進行')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(session.storage.setItem).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { files: [file()] } })
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Importを確定' }))
    expect(session.reload).toHaveBeenCalledTimes(1)
  })
  it('shows validation failure without opening confirmation', async () => {
    const session = setup()
    render(<App {...session} />)
    fireEvent.change(screen.getByLabelText(/JSONファイルをImport/), { target: { files: [file('{')] } })
    await waitFor(() => expect(screen.getByLabelText('セーブ管理の通知').textContent).toMatch(/Import不可/))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(session.storage.setItem).not.toHaveBeenCalled()
  })
  it('ignores late file reads after unmount', async () => {
    const session = setup()
    let finish!: (value: string) => void
    const view = render(<App {...session} />)
    fireEvent.change(screen.getByLabelText(/JSONファイルをImport/), { target: { files: [{ size: 1, text: () => new Promise<string>(resolve => { finish = resolve }) }] } })
    view.unmount()
    await act(async () => { finish(serializeSaveData(initial())) })
    expect(session.reload).not.toHaveBeenCalled()
    expect(session.storage.removeItem).not.toHaveBeenCalled()
  })
})

it('downloads a named JSON and revokes its object URL', () => {
  vi.useFakeTimers()
  const create = vi.fn(() => 'blob:test'), revoke = vi.fn()
  const oldCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const oldRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) {
    expect(this.download).toMatch(/^gacha-raid-UNVERIFIED-.*\.json$/)
  })
  try {
    downloadSave('{broken', true)
    expect(click).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(document.querySelector('a[download]')).toBeNull()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:test')
  } finally {
    if (oldCreate) Object.defineProperty(URL, 'createObjectURL', oldCreate)
    else Reflect.deleteProperty(URL, 'createObjectURL')
    if (oldRevoke) Object.defineProperty(URL, 'revokeObjectURL', oldRevoke)
    else Reflect.deleteProperty(URL, 'revokeObjectURL')
  }
})
