import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Autosave } from './storage/autosave'
import { SaveStatus } from './components/SaveStatus'
import { BattlePanel } from './components/BattlePanel'
import { ResourcePanel } from './components/ResourcePanel'
import { PullControls } from './components/PullControls'
import { PullResultSummary } from './components/PullResultSummary'
import { UpgradePanel } from './components/UpgradePanel'
import { FocusPanel } from './components/FocusPanel'
import { StatisticsPanel } from './components/StatisticsPanel'
import { ResultEffects } from './components/ResultEffects'
import { createBattleController, type BattleController } from './ui/battleController'

export default function App({ controller: suppliedController, persistence }: { controller?: BattleController; persistence?: Autosave }) {
  const [controller] = useState(() => suppliedController ?? createBattleController())
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => persistence?.connect(), [persistence])
  return (
    <main>
      <p className="eyebrow">ブラウザで遊ぶ、ガチャ × ボスバトル</p>
      <h1>GACHA RAID<span>RESONANCE</span></h1>
      {persistence ? <SaveStatus persistence={persistence} /> : <p className="save-notice">自動保存は未接続です（検証用）。</p>}
      <BattlePanel state={snapshot.state} />
      <div className="battle-grid"><ResourcePanel state={snapshot.state} /><PullControls controller={controller} snapshot={snapshot} /></div>
      <PullResultSummary snapshot={snapshot} />
      <ResultEffects highlight={snapshot.highlight} settings={snapshot.settings} onReducedEffectsChange={controller.setReducedEffects} />
      <div role="status" aria-label="育成操作の通知" className={snapshot.notice?.kind === 'error' ? 'error' : 'operation-notice'}>{snapshot.notice?.text}</div>
      <UpgradePanel snapshot={snapshot} controller={controller} />
      <FocusPanel snapshot={snapshot} controller={controller} />
      <StatisticsPanel state={snapshot.state} />
      <footer><a className="return-to-pull" href="#pull-title">PULLへ戻る</a><p>自動保存はこのブラウザ内のみです。Export/Import・削除操作は今後追加します。</p></footer>
    </main>
  )
}
