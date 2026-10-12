import type { SaveDataV1 } from '../types/game'
import { deserializeSaveData, serializeSaveData } from './saveCodec'

export const SAVE_STORAGE_KEY = 'gacha-raid-resonance:save'
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>
const explanation = (error: unknown) => error instanceof Error ? error.message : 'ストレージを利用できません'

/** Owns the expected raw value. Invalid/unreadable data is never overwritten.
 * Compare-before-write and storage events detect other tabs; not a cross-tab CAS.
 */
export function openLocalSave(getStorage: () => SaveStorage) {
  let storage: SaveStorage | null = null
  let expected: string | null = null
  let data: SaveDataV1 | null = null
  let blocked: string | null = null
  try {
    storage = getStorage()
    expected = storage.getItem(SAVE_STORAGE_KEY)
    if (expected !== null) data = deserializeSaveData(expected)
  } catch (error) {
    blocked = `保存データを読み込めません。元データを保護して保存を停止しています：${explanation(error)}`
  }
  function checkExternal(raw: string | null): void {
    if (raw !== expected) blocked = '別のタブで保存データが変更されました。上書きを防ぐため保存を停止しました。再読込して最新のデータを確認してください。'
  }
  return {
    data,
    getBlockedReason: () => blocked,
    checkExternal,
    matchesStorageArea: (area: Storage | null) => area === null || area === storage,
    write: (checkpoint: SaveDataV1) => {
      if (blocked || !storage) throw new Error(blocked ?? '保存先を利用できません')
      const json = serializeSaveData(checkpoint)
      checkExternal(storage.getItem(SAVE_STORAGE_KEY))
      if (blocked) throw new Error(blocked)
      storage.setItem(SAVE_STORAGE_KEY, json)
      expected = json // update only after a successful write
    },
  }
}
export type LocalSave = ReturnType<typeof openLocalSave>
