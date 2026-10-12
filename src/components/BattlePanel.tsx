import { calculateBossMaxHp, getBossInfo } from '../game/boss'
import { hasClearedGame } from '../game/progression'
import type { GameState } from '../types/game'
import { formatNumber as n } from '../ui/format'

export function BattlePanel({ state }: { state: GameState }) {
  const boss = getBossInfo(state.stage)
  const maxHp = calculateBossMaxHp(state.stage)
  const percentage = Math.max(0, Math.min(100, state.bossHp / maxHp * 100))
  return <section aria-labelledby="boss-title" className="boss-panel">
    <div className="section-top"><p className="eyebrow">RAID TARGET</p><span>最高到達 Stage {n(state.highestStage)}</span></div>
    <h2 id="boss-title">Stage {n(state.stage)} <span>{boss.name}</span></h2>
    {hasClearedGame(state) && <p className="clear-badge">Stage 50 クリア済み — 続けてプレイできます</p>}
    <div className="hp-label"><strong>ボスHP</strong><span>{n(state.bossHp)} / {n(maxHp)}</span></div>
    <div className="hp-track" role="progressbar" aria-label="ボスHP" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${n(state.bossHp)} / ${n(maxHp)}`}><div style={{ width: `${percentage}%` }} /></div>
    <p className="traits"><strong>弱点・耐性 / 特性</strong><br />{boss.description}</p>
  </section>
}
