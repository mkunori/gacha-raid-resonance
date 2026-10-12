import { CORE_RULES } from '../data/rules'
import { isFeatureUnlocked } from '../game/progression'
import type { GameState } from '../types/game'
import { formatNumber as n } from '../ui/format'

export function ResourcePanel({ state }: { state: GameState }) {
  return <section aria-labelledby="resources-title">
    <h2 id="resources-title">リソースと共鳴</h2>
    <dl className="resource-grid">
      <div><dt>RS</dt><dd>{n(state.resonanceShards)}</dd></div>
      <div><dt>SPECIAL GAUGE</dt><dd>{n(state.specialGauge)} <small>/ 1回 {CORE_RULES.specialGaugeCost}</small></dd></div>
      <div><dt>CATALYST</dt><dd>{state.catalyst} / 3</dd></div>
      <div><dt>Focus（表示のみ）</dt><dd>{state.focus}</dd></div>
    </dl>
    <div className="stacks">{(['FIRE', 'WIND', 'THUNDER'] as const).map((element) => <div key={element} className={element.toLowerCase()}><strong>{element}</strong><span>{state.stacks[element]} / {CORE_RULES.stackCap}</span></div>)}</div>
    <p className="muted">BOOST {state.temporary.boostCount} / 3 · THUNDER予約 {state.temporary.thunderStormReserved ? 'あり' : 'なし'}<br />FLAME強化：残り {state.temporary.flameStormPullsRemaining} 通常PULL</p>
    {isFeatureUnlocked(state, 'JACKPOT') ? <p>JACKPOT区間 {state.jackpot.pullsInWindow} / {CORE_RULES.jackpotWindow} · SSR {state.jackpot.ssrInWindow} 個</p> : <p className="muted">JACKPOT：Stage 20で解放</p>}
  </section>
}
