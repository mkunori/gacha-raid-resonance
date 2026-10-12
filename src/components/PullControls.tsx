import { CORE_RULES, UNLOCK_STAGES } from '../data/rules'
import { isFeatureUnlocked } from '../game/progression'
import { UI_AUTO_PULL_LIMIT, type BattleController, type BattleSnapshot } from '../ui/battleController'
import { formatNumber as n } from '../ui/format'

export function PullControls({ controller, snapshot }: { controller: BattleController; snapshot: BattleSnapshot }) {
  const { state, busy, error } = snapshot
  const pending = state.pendingNormalPulls + state.pendingSpecialPulls
  const unavailable = busy || pending > 0
  return <section aria-labelledby="pull-title">
    <h2 id="pull-title">PULL</h2>
    <p className="eyebrow">NORMAL / CHAINを含めて実行</p>
    <div className="normal-buttons">{([1, 10, 100, 1000] as const).map((count) => {
      const unlocked = isFeatureUnlocked(state, `NORMAL_${count}`)
      const stage = count === 100 ? UNLOCK_STAGES.normal100 : UNLOCK_STAGES.normal1000
      return <button key={count} aria-label={`NORMAL ×${count}`} aria-describedby={`normal-${count}-hint`} disabled={unavailable || !unlocked} onClick={() => void controller.start({ kind: 'normal', count })}>NORMAL ×{count}<small id={`normal-${count}-hint`}>{unlocked ? '解放済み' : `Stage ${stage}で解放`}</small></button>
    })}</div>
    <p className="eyebrow">SPECIAL / 手動実行・1回{CORE_RULES.specialGaugeCost}ゲージ</p>
    <div className="special-buttons">{([1, 'MAX'] as const).map((count) => {
      const unlocked = isFeatureUnlocked(state, count === 1 ? 'SPECIAL_1' : 'SPECIAL_MAX')
      const enough = state.specialGauge >= CORE_RULES.specialGaugeCost
      return <button key={count} aria-label={`SPECIAL ×${count}`} aria-describedby={`special-${count}-hint`} disabled={unavailable || !unlocked || !enough} onClick={() => void controller.start({ kind: 'special', count })}>SPECIAL ×{count}<small id={`special-${count}-hint`}>{!unlocked ? `Stage ${UNLOCK_STAGES.specialMax}で解放` : !enough ? 'ゲージ不足' : '実行可能'}</small></button>
    })}</div>
    <p role="status" aria-label="PULL実行状態">{busy ? '処理中です。ほかの操作は完了までお待ちください。' : snapshot.paused ? `${n(UI_AUTO_PULL_LIMIT)}実PULLの安全上限で一時停止しました。残りは再開できます。` : pending ? '未実行PULLがあります。再開してください。' : '次のPULLを選んでください。'}</p>
    {(busy || pending > 0) && <p>実行済み {n(snapshot.result?.value.actualPulls ?? 0)} · 未実行 {n(pending)} PULL</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {!busy && pending > 0 && <><button onClick={() => void controller.resume()}>保留PULLを再開</button><p className="muted">保持した状態と乱数ストリームの続きから再開します。再開も最大{n(UI_AUTO_PULL_LIMIT)}実PULLで一時停止します。{error && 'エラーの原因が解消しない場合は再度停止します。'}</p></>}
  </section>
}
