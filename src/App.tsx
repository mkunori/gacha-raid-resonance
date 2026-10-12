import { useState, useSyncExternalStore } from 'react'
import { BattlePanel } from './components/BattlePanel'
import { ResourcePanel } from './components/ResourcePanel'
import { PullControls } from './components/PullControls'
import { PullResultSummary } from './components/PullResultSummary'
import { UpgradePanel } from './components/UpgradePanel'
import { FocusPanel } from './components/FocusPanel'
import { createBattleController, type BattleController } from './ui/battleController'

export default function App({ controller: suppliedController }: { controller?: BattleController }) {
  const [controller] = useState(() => suppliedController ?? createBattleController())
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  return (
    <main>
      <p className="eyebrow">ブラウザで遊ぶ、ガチャ × ボスバトル</p>
      <h1>GACHA RAID<span>RESONANCE</span></h1>
      <p className="save-notice">開発版・保存機能は未実装です。再読込すると最初からになります。</p>
      <BattlePanel state={snapshot.state} />
      <div className="battle-grid"><ResourcePanel state={snapshot.state} /><PullControls controller={controller} snapshot={snapshot} /></div>
      <PullResultSummary snapshot={snapshot} />
      <div role="status" aria-label="育成操作の通知" className={snapshot.notice?.kind === 'error' ? 'error' : 'operation-notice'}>{snapshot.notice?.text}</div>
      <UpgradePanel snapshot={snapshot} controller={controller} />
      <FocusPanel snapshot={snapshot} controller={controller} />
      <footer>保存・詳細演出・統計画面は今後追加します。</footer>
    </main>
  )
}
