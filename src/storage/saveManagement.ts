import type { BattleController } from '../ui/battleController'
import type { SaveDataV1 } from '../types/game'
import type { Autosave } from './autosave'
import { SAVE_STORAGE_KEY, type SaveStorage } from './localSave'
import { deserializeSaveData, MAX_SAVE_JSON_LENGTH, SaveDataError, serializeSaveData } from './saveCodec'

export const MAX_IMPORT_BYTES = MAX_SAVE_JSON_LENGTH * 2
export interface SaveFile { size: number; text(): Promise<string> }
interface Confirmation { checkpoint: SaveDataV1; raw: string | null; data: SaveDataV1 | null }
export type SaveConfirmation = Readonly<Confirmation>
export type ManagementStorage = SaveStorage & Pick<Storage, 'removeItem'>

/** Explicit user-confirmed replacement, distinct from normal blocked autosave.
 * Compare-before-write is not cross-tab CAS. Success retires the old session, then reloads.
 */
export function createSaveManagement(controller: BattleController, persistence: Autosave,
  getStorage: () => ManagementStorage, reload: () => void) {
  const tickets = new WeakMap<SaveConfirmation, Confirmation>()
  let completed = false
  function current() {
    if (completed) throw new Error('置換済みです。再読込してください。')
    if (controller.getSnapshot().busy) throw new Error('PULL処理中はセーブ管理操作ができません。')
    const checkpoint = controller.getCheckpoint()
    if (!checkpoint) throw new Error('保存可能なRNGが接続されていません。')
    return checkpoint
  }
  function ticket(data: SaveDataV1 | null): SaveConfirmation {
    const value = { checkpoint: current(), raw: getStorage().getItem(SAVE_STORAGE_KEY), data }
    // Public previews are detached from the private transaction data.
    const preview = { ...value, data: data ? deserializeSaveData(serializeSaveData(data)) : null }
    tickets.set(preview, value)
    return preview
  }
  return {
    exportCurrent: () => serializeSaveData(current()),
    backupRaw: () => {
      const raw = getStorage().getItem(SAVE_STORAGE_KEY)
      if (raw === null) throw new Error('バックアップできる保存元データがありません。')
      return raw
    },
    prepareImport: async (file: SaveFile): Promise<SaveConfirmation> => {
      const checkpoint = current()
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_IMPORT_BYTES) {
        throw new SaveDataError('SIZE', `ファイルは${MAX_IMPORT_BYTES}バイト以内にしてください。`)
      }
      let text: string
      try { text = await file.text() } catch { throw new Error('ファイルを読み込めません。') }
      const data = deserializeSaveData(text)
      if (current() !== checkpoint) throw new Error('読込中に状態が変わりました。ファイルを選択し直してください。')
      return ticket(data)
    },
    prepareDelete: () => ticket(null),
    confirm: (preview: SaveConfirmation) => {
      const token = tickets.get(preview)
      if (!token || current() !== token.checkpoint) throw new Error('状態が変わりました。最新の内容で再確認してください。')
      const storage = getStorage()
      persistence.suspend()
      try {
        if (storage.getItem(SAVE_STORAGE_KEY) !== token.raw) throw new Error('保存データが変更されました。再読込または再確認してください。')
        if (token.data) storage.setItem(SAVE_STORAGE_KEY, serializeSaveData(token.data))
        else storage.removeItem(SAVE_STORAGE_KEY)
      } catch (error) {
        persistence.resume()
        throw error
      }
      completed = true
      persistence.retire()
      reload()
    },
  }
}
export type SaveManagement = ReturnType<typeof createSaveManagement>

/** Local download only. Revoke after the browser has consumed the click. */
export function downloadSave(json: string, raw = false): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `gacha-raid-${raw ? 'UNVERIFIED-' : ''}${new Date().toISOString().replaceAll(':', '-')}.json`
  document.body.append(link)
  try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0) }
}
