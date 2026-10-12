import { useState } from 'react'
import type { DisplaySettings } from '../types/game'
import type { BattleSnapshot } from '../ui/battleController'
import { highlightFacts } from '../ui/highlightFacts'

export function ResultEffects({ highlight, settings: controlledSettings, onReducedEffectsChange }: {
  highlight: BattleSnapshot['highlight']; settings?: DisplaySettings; onReducedEffectsChange?: (value: boolean) => void
}) {
  // Standalone component fixtures may omit the controlled settings. App always supplies them.
  const [localSettings, setLocalSettings] = useState<DisplaySettings>({ reducedEffects: false })
  const settings = controlledSettings ?? localSettings
  const [skippedId, setSkippedId] = useState<number | null>(null)
  const facts = highlight ? highlightFacts(highlight.result) : []
  const reduced = settings.reducedEffects || skippedId === highlight?.id
  return <section aria-labelledby="effects-title">
    <h2 id="effects-title">結果ハイライト・表示設定</h2>
    <label className="effects-toggle"><input type="checkbox" checked={settings.reducedEffects} onChange={(event) => onReducedEffectsChange ? onReducedEffectsChange(event.target.checked) : setLocalSettings({ reducedEffects: event.target.checked })} /> 演出軽減</label>
    <p className="muted">OSの動きを減らす設定も尊重します。演出軽減は自動保存の対象です。スキップは現在の演出だけに適用し、結果テキストと戦闘処理は維持します。</p>
    <button disabled={!facts.length} onClick={() => setSkippedId(highlight?.id ?? null)}>演出をスキップ</button>
    <p className="muted">新しい確定分がない場合は以前の結果を表示します。最初のチャンクで失敗した操作の結果ではありません。</p>
    <div role="status" aria-label="結果ハイライト" aria-live="polite" aria-atomic="true">
      {facts.length > 0 && <div key={highlight!.id} className={`result-highlight${reduced ? ' reduced-effects' : ''}${highlight!.result.value.clearedGame ? ' clear-highlight' : ''}`}>
        <p>直近の確定結果（完了・一時停止・エラー停止までの新規集計）</p>
        <ul>{facts.map((fact) => <li key={fact} className={fact.startsWith('JACKPOT') ? 'jackpot-highlight' : /SSR|共鳴|BURST/.test(fact) ? 'rare-highlight' : ''}>{fact}</li>)}</ul>
      </div>}
    </div>
  </section>
}
