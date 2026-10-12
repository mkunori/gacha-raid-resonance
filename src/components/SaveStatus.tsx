import { useSyncExternalStore } from 'react'
import type { Autosave } from '../storage/autosave'

export function SaveStatus({ persistence }: { persistence: Autosave }) {
  const status = useSyncExternalStore(persistence.subscribe, persistence.getSnapshot)
  return <p className={`save-notice${status.kind === 'error' || status.kind === 'blocked' ? ' error' : ''}`}
    role="status" aria-label="保存状態" aria-live="polite">{status.message}</p>
}
