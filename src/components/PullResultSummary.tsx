import type { BattleSnapshot } from '../ui/battleController'
import { formatNumber as n } from '../ui/format'

export function PullResultSummary({ snapshot }: { snapshot: BattleSnapshot }) {
  const result = snapshot.result
  return <section aria-labelledby="result-title"><h2 id="result-title">直前のPULL結果</h2>
    {!result ? <p className="muted">PULLすると集計を表示します。</p> : <>
      <p>{result.kind === 'normal' ? 'NORMAL' : 'SPECIAL'} · {snapshot.busy ? '集計中' : result.value.pendingPulls ? '保留あり' : '完了'}</p>
      <dl className="resource-grid">
        <div><dt>実PULL</dt><dd>{n(result.value.actualPulls)}</dd></div><div><dt>撃破数</dt><dd>{n(result.value.stagesAdvanced)}</dd></div>
        <div><dt>獲得RS</dt><dd>+{n(result.value.earnedShards)}</dd></div><div><dt>Stage変化</dt><dd>{n(snapshot.startStage)} → {n(snapshot.state.stage)}</dd></div>
      </dl>
      {result.kind === 'normal' ? <><p>CHAIN追加 {n(result.value.chainAdded)} · SSR {n(result.value.ssrCount)} · JACKPOT {n(result.value.jackpotCount)}</p><p>共鳴：{Object.entries(result.value.resonanceCounts).map(([name, count]) => `${name} ${n(count)}`).join(' / ')}</p><p>追加効果：{Object.entries(result.value.effectCounts).map(([name, count]) => `${name} ${n(count)}`).join(' / ')}</p></> : <><p>消費ゲージ {n(result.value.gaugeSpent)}</p><p>{Object.entries(result.value.resultCounts).map(([name, count]) => `${name} ${n(count)}`).join(' / ')}</p></>}
      {result.value.clearedGame && <p className="clear-badge">この操作でStage 50をクリアしました！</p>}
    </>}
  </section>
}
