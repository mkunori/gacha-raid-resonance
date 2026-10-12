import { useEffect, useRef, useState } from 'react'
import type { BattleSnapshot } from '../ui/battleController'
import type { GameState } from '../types/game'
import { downloadSave, type SaveConfirmation, type SaveManagement } from '../storage/saveManagement'
import { formatNumber as n } from '../ui/format'

function Preview({ state }: { state: GameState }) {
  return <ul>
    <li>Stage {n(state.stage)} / 最高到達Stage {n(state.highestStage)} / RS {n(state.resonanceShards)}</li>
    <li>{Object.entries(state.upgradeLevels).map(([key, level]) => `${key.replaceAll('_', ' ')} Lv ${n(level)}`).join(' / ')}</li>
    <li>保留NORMAL基本 {n(state.normalPullQueue.base)} / CHAIN {n(state.normalPullQueue.chain)} / SPECIAL {n(state.pendingSpecialPulls)}</li>
  </ul>
}

function SaveDialog({ token, management, onClose, onError }: {
  token: SaveConfirmation; management: SaveManagement; onClose: () => void; onError: (text: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const settled = useRef(false)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal(); cancel.current?.focus()
    return () => {
      element.close()
      if (opener?.isConnected) opener.focus()
      if (document.activeElement !== opener) document.getElementById('save-management-title')?.focus()
    }
  }, [])
  return <dialog ref={dialog} aria-labelledby="save-dialog-title" aria-describedby="save-dialog-warning"
    onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === cancel.current) { event.preventDefault(); confirm.current?.focus() }
        if (!event.shiftKey && document.activeElement === confirm.current) { event.preventDefault(); cancel.current?.focus() }
      }
    }}>
    <h2 id="save-dialog-title">{token.data ? 'Importの確認' : 'セーブ削除の確認'}</h2>
    <p id="save-dialog-warning">現在の進行は置き換わり、元に戻せません。先にExportを推奨します。破損・未来版の保存は未検証バックアップを取得してください。</p>
    <h3>現在の画面の進行</h3><Preview state={token.checkpoint.state} />
    <p>演出軽減：{token.checkpoint.settings.reducedEffects ? 'ON' : 'OFF'}</p>
    {token.data ? <><h3>Importする進行</h3><Preview state={token.data.state} />
      <p>演出軽減：{token.data.settings.reducedEffects ? 'ON' : 'OFF'} / 保留PULLは手動再開</p></>
      : <p>このゲームの保存だけを削除し、新しい乱数でStage 1から開始します。</p>}
    <div className="dialog-actions">
      <button ref={cancel} onClick={onClose}>キャンセル</button>
      <button ref={confirm} onClick={() => {
        if (settled.current) return
        settled.current = true
        try { management.confirm(token) } catch (error) { onError(`変更できません：${error instanceof Error ? error.message : '保存操作に失敗しました'}`) }
        onClose()
      }}>{token.data ? 'Importを確定' : '削除して最初から'}</button>
    </div>
  </dialog>
}

export function SaveManagementPanel({ management, snapshot }: { management: SaveManagement; snapshot: BattleSnapshot }) {
  const [token, setToken] = useState<SaveConfirmation | null>(null)
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState('')
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const disabled = snapshot.busy || reading
  const report = (action: () => void) => {
    try { action() } catch (error) { setMessage(error instanceof Error ? `${error.name}: ${error.message}` : '操作に失敗しました。') }
  }
  return <section aria-labelledby="save-management-title">
    <h2 id="save-management-title" tabIndex={-1}>セーブデータ管理</h2>
    <p className="muted">Exportは現在の画面の最新確定結果です。保存失敗・保存停止中も未保存プレイを出力できます。処理中は操作できません。</p>
    <div className="save-actions">
      <button disabled={disabled} onClick={() => report(() => { downloadSave(management.exportCurrent()); setMessage('最新の確定状態のExportを開始しました。') })}>現在の進行をExport</button>
      <button disabled={disabled} onClick={() => {
        try { downloadSave(management.backupRaw(), true); setMessage('未検証の保存元データのダウンロードを開始しました。有効なゲームデータとは限りません。') }
        catch (error) { setMessage(`バックアップ不可：${error instanceof Error ? error.message : '読み込めません'}`) }
      }}>未検証の保存元データをバックアップ</button>
    </div>
    <label className="save-file">JSONファイルをImport（最大128 KiB）
      <input type="file" accept=".json,application/json" disabled={disabled} onChange={async event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setReading(true); setMessage('ファイルを検証中です。')
        try {
          const next = await management.prepareImport(file)
          if (mounted.current) { setToken(next); setMessage('検証済みです。内容を確認してください。') }
        } catch (error) {
          if (mounted.current) setMessage(`Import不可：${error instanceof Error ? error.message : 'ファイルを読み込めません'}`)
        } finally { if (mounted.current) setReading(false) }
      }} />
    </label>
    <button disabled={disabled} onClick={() => report(() => { setToken(management.prepareDelete()); setMessage('') })}>セーブを削除して最初から</button>
    <p className="muted">Import・削除は確認後に実行し、成功時にページを再読込します。保存停止中も明示的な復旧として利用できます。別タブの更新後は再確認してください。</p>
    <p className="muted">保存はこのブラウザ内です。Exportファイルを他人と共有するとゲーム状態が分かります。暗号化・クラウド同期はありません。</p>
    <p role="status" aria-label="セーブ管理の通知">{message}</p>
    {token && <SaveDialog token={token} management={management} onClose={() => setToken(null)} onError={setMessage} />}
  </section>
}
