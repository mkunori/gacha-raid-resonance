import type { GameState } from '../types/game'
import { formatNumber as n } from '../ui/format'

export function StatisticsPanel({ state }: { state: GameState }) {
  const stats = state.statistics
  const entries: readonly (readonly [string, number])[] = [
    ['累積NORMAL PULL', stats.totalNormalPulls], ['累積SPECIAL PULL', stats.totalSpecialPulls],
    ['SSR累積数', stats.ssrCount], ...Object.entries(stats.resonanceCounts).map(([name, count]) => [`${name}累積`, count] as const),
    ['ボス撃破数', stats.bossesDefeated], ['JACKPOT累積', stats.jackpotCount], ['最高到達Stage', state.highestStage],
  ]
  return <section aria-labelledby="statistics-title"><h2 id="statistics-title">累積統計</h2>
    <p className="muted">保存された進行を含む累計です。直前のPULL結果とは別に集計します。</p>
    <dl className="resource-grid">{entries.map(([name, count]) => <div key={name}><dt>{name}</dt><dd>{n(count)}</dd></div>)}</dl>
  </section>
}
