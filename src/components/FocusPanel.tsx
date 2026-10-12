import { FOCUS_PROBABILITIES, UNLOCK_STAGES } from '../data/rules'
import { isFeatureUnlocked } from '../game/progression'
import type { Focus } from '../types/game'
import type { BattleController, BattleSnapshot } from '../ui/battleController'

export function FocusPanel({ snapshot, controller }: { snapshot: BattleSnapshot; controller: BattleController }) {
  const { state, busy } = snapshot
  const unlocked = isFeatureUnlocked(state, 'FOCUS')
  const blocked = busy || state.pendingNormalPulls > 0 || state.pendingSpecialPulls > 0
  return <section aria-labelledby="focus-title">
    <h2 id="focus-title">属性Focus / 無料切替</h2>
    <p id="focus-hint">{blocked ? 'PULL処理中・保留中は変更できません。' : !unlocked ? `Stage ${UNLOCK_STAGES.focus}到達で解放。それまではBALANCED固定です。` : '解放済み。選ぶと次のPULLから反映されます。'}</p>
    <fieldset disabled={blocked || !unlocked} aria-describedby="focus-hint"><legend>属性分布を選択</legend><div className="focus-options">
      {(Object.keys(FOCUS_PROBABILITIES) as Focus[]).map((focus) => {
        const probabilities = FOCUS_PROBABILITIES[focus]
        return <label key={focus} className={state.focus === focus ? 'focus-option selected' : 'focus-option'}>
          <span><input type="radio" name="focus" value={focus} checked={state.focus === focus} onChange={() => controller.changeFocus(focus, state)} /> {focus} {state.focus === focus && '（選択中）'}</span>
          <small>炎 FIRE {probabilities.FIRE * 100}% · 風 WIND {probabilities.WIND * 100}% · 雷 THUNDER {probabilities.THUNDER * 100}%</small>
        </label>
      })}
    </div></fieldset>
  </section>
}
