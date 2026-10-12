import { useEffect, useRef } from 'react'
import type { GameState } from '../types/game'
import type { BattleController } from '../ui/battleController'
import { formatNumber as n } from '../ui/format'

export function RespecDialog({ state, controller, onClose }: { state: GameState; controller: BattleController; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const settled = useRef(false)
  const refund = Object.values(state.spentShards).reduce((sum, paid) => sum + paid, 0)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    cancel.current?.focus()
    return () => {
      element.close()
      if (opener?.isConnected) opener.focus()
      // Confirming may disable the opener (no refundable payments remain).
      if (document.activeElement !== opener) document.getElementById('upgrade-title')?.focus()
    }
  }, [])
  return <dialog ref={dialog} aria-labelledby="respec-title" aria-describedby="respec-description" onCancel={(event) => { event.preventDefault(); onClose() }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (event.key === 'Tab') {
      if (event.shiftKey && document.activeElement === cancel.current) { event.preventDefault(); confirm.current?.focus() }
      if (!event.shiftKey && document.activeElement === confirm.current) { event.preventDefault(); cancel.current?.focus() }
    }
  }}>
    <h2 id="respec-title">無料RESPECの確認</h2>
    <p id="respec-description">全3種類の強化をLv0へ戻します。手数料は無料です。実支払台帳のRSを全額返還します。</p>
    <ul>{Object.entries(state.upgradeLevels).map(([upgrade, level]) => <li key={upgrade}>{upgrade.replaceAll('_', ' ')}：Lv {n(level)} → 0</li>)}</ul>
    <p className="refund">返還予定：{n(refund)} RS</p>
    <div className="dialog-actions">
      <button ref={cancel} onClick={onClose}>キャンセル</button>
      <button ref={confirm} onClick={() => {
        if (settled.current) return
        settled.current = true
        controller.respec(state)
        onClose()
      }}>RESPECを確定</button>
    </div>
  </dialog>
}
