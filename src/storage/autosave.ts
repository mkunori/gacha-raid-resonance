import type { BattleController } from '../ui/battleController'
import type { SaveDataV1 } from '../types/game'
import { SAVE_STORAGE_KEY, type LocalSave } from './localSave'

export const SAVE_DEBOUNCE_MS = 500
export const SAVE_MAX_WAIT_MS = 2000
export interface SaveStatus { kind: 'pending' | 'saving' | 'saved' | 'error' | 'blocked'; message: string }

/** No RNG sampling here: only whole immutable checkpoints from the controller.
 * connect/cleanup is repeatable for StrictMode. Timers/listeners exist only while connected.
 */
export function createAutosave(controller: BattleController, adapter: LocalSave,
  lifecycle: { window: Window; document: Document }) {
  let latest = controller.getCheckpoint()
  let written: SaveDataV1 | null = adapter.data ? latest : null
  let snapshot: SaveStatus = adapter.getBlockedReason()
    ? { kind: 'blocked', message: adapter.getBlockedReason()! }
    : adapter.data ? { kind: 'saved', message: '前回のデータを復元しました。保存済みです。' }
      : { kind: 'pending', message: '新規ゲームです。保存待ちです。' }
  const listeners = new Set<() => void>()
  const publish = (next: SaveStatus) => {
    if (snapshot.kind === next.kind && snapshot.message === next.message) return
    snapshot = next; listeners.forEach(listener => listener())
  }
  let debounce: ReturnType<typeof setTimeout> | undefined
  let maximum: ReturnType<typeof setTimeout> | undefined
  let suspended = false
  let retired = false
  let disconnect: (() => void) | null = null
  const clear = () => { clearTimeout(debounce); clearTimeout(maximum); debounce = maximum = undefined }
  function flush(): void {
    clear()
    if (suspended || retired) return
    const blocked = adapter.getBlockedReason()
    if (blocked) { publish({ kind: 'blocked', message: blocked }); return }
    if (!latest || latest === written) return
    const candidate = latest
    publish({ kind: 'saving', message: '保存中です。' })
    try {
      adapter.write(candidate)
      written = candidate
      publish({ kind: 'saved', message: '保存済みです。' })
    } catch (error) {
      const reason = adapter.getBlockedReason()
      publish({ kind: reason ? 'blocked' : 'error', message: reason ?? `保存失敗：${error instanceof Error ? error.message : '保存できません'}。画面上の進行は保持しています。` })
    }
  }
  function schedule(): void {
    if (suspended || retired || adapter.getBlockedReason() || latest === written || !latest) return
    publish({ kind: 'pending', message: '未保存の変更があります（保存待ち）。' })
    clearTimeout(debounce)
    debounce = setTimeout(flush, SAVE_DEBOUNCE_MS)
    maximum ??= setTimeout(flush, SAVE_MAX_WAIT_MS)
  }
  let connected = false
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    flush,
    // Synchronous replacement transaction: no old flush, including cleanup/pagehide.
    suspend: () => { suspended = true; clear() },
    resume: () => { if (!retired) { suspended = false; schedule() } },
    retire: () => { retired = true; clear(); disconnect?.() },
    connect: () => {
      if (connected || retired) return () => {}
      connected = true
      const onCommit = () => {
        const next = controller.getCheckpoint()
        if (next === latest) return
        latest = next
        schedule()
      }
      const unsubscribe = controller.subscribe(onCommit)
      const onHidden = () => { if (lifecycle.document.visibilityState === 'hidden') flush() }
      const onStorage = (event: StorageEvent) => {
        if (!adapter.matchesStorageArea(event.storageArea)) return
        if (event.key !== SAVE_STORAGE_KEY && event.key !== null) return
        adapter.checkExternal(event.key === null ? null : event.newValue)
        if (adapter.getBlockedReason()) { clear(); publish({ kind: 'blocked', message: adapter.getBlockedReason()! }) }
      }
      lifecycle.window.addEventListener('pagehide', flush)
      lifecycle.window.addEventListener('storage', onStorage)
      lifecycle.document.addEventListener('visibilitychange', onHidden)
      onCommit()
      schedule()
      let detached = false
      disconnect = () => {
        if (detached) return
        detached = true
        flush()
        connected = false
        unsubscribe()
        lifecycle.window.removeEventListener('pagehide', flush)
        lifecycle.window.removeEventListener('storage', onStorage)
        lifecycle.document.removeEventListener('visibilitychange', onHidden)
      }
      return disconnect
    },
  }
}
export type Autosave = ReturnType<typeof createAutosave>
