import { useCallback, useState } from 'react'
import { UPGRADE_RULES } from '../data/rules'
import { isUpgradeUnlocked } from '../game/progression'
import { getUpgradeInfo } from '../game/upgrades'
import type { Upgrade } from '../types/game'
import type { BattleController, BattleSnapshot } from '../ui/battleController'
import { formatNumber as n } from '../ui/format'
import { RespecDialog } from './RespecDialog'

const descriptions: Record<Upgrade, string> = {
  PULL_POWER: '基礎攻撃力を強化。通常・共鳴・SPECIAL・JACKPOTに反映。',
  RESONANCE_POWER: '共鳴ダメージを強化。',
  SPECIAL_POWER: 'SPECIALダメージを強化。',
}
export function UpgradePanel({ snapshot, controller }: { snapshot: BattleSnapshot; controller: BattleController }) {
  const { state, busy } = snapshot
  const [confirming, setConfirming] = useState(false)
  const close = useCallback(() => setConfirming(false), [])
  const blocked = busy || state.pendingNormalPulls > 0 || state.pendingSpecialPulls > 0
  const paid = Object.values(state.spentShards).reduce((sum, value) => sum + value, 0)
  return <section aria-labelledby="upgrade-title">
    <h2 id="upgrade-title" tabIndex={-1}>強化 / 共通RS {n(state.resonanceShards)}</h2>
    <div className="upgrade-list">{(Object.keys(UPGRADE_RULES) as Upgrade[]).map((upgrade) => {
      const rule = UPGRADE_RULES[upgrade]
      const info = getUpgradeInfo(state, upgrade)
      const unlocked = isUpgradeUnlocked(state, upgrade)
      const unlockText = upgrade === 'RESONANCE_POWER' ? `Stage ${rule.unlockStage - 1}撃破（Stage ${rule.unlockStage}到達）` : rule.unlockStage === 1 ? '初期解放' : `Stage ${rule.unlockStage}到達`
      const reason = busy ? 'PULL処理中' : info.purchaseBlockReason === 'PENDING_PULLS' ? '保留PULLを再開してください' : !unlocked ? `未解放：${unlockText}` : info.purchaseBlockReason === 'NUMERIC_LIMIT' ? '数値上限のため購入不可' : info.purchaseBlockReason === 'INSUFFICIENT_RS' ? 'RS不足' : '購入可能'
      return <article key={upgrade} aria-labelledby={`${upgrade}-title`} className="upgrade-card">
        <h3 id={`${upgrade}-title`}>{upgrade.replaceAll('_', ' ')} <span>Lv {n(info.level)}</span></h3>
        <p>{descriptions[upgrade]}</p>
        <p>1Lv ×{rule.multiplier.toFixed(2)} · 合計 ×{n(rule.multiplier ** info.level)}</p>
        <p>次価格：{info.nextCost === null ? '数値上限' : `${n(info.nextCost)} RS`} · 支払済み：{n(info.spentShards)} RS</p>
        <p className="muted">解放条件：{unlockText} / {unlocked ? '解放済み' : '未解放'}</p>
        <button aria-label={`${upgrade.replaceAll('_', ' ')} +1購入`} aria-describedby={`${upgrade}-reason`} disabled={blocked || !info.canPurchase} onClick={(event) => { if (event.detail <= 1) controller.purchase(upgrade, state) }}>+1購入</button>
        <p id={`${upgrade}-reason`} className="muted">{reason}</p>
      </article>
    })}</div>
    <div className="respec-row"><button disabled={blocked || paid === 0} aria-describedby="respec-hint" onClick={() => setConfirming(true)}>無料RESPEC</button><p id="respec-hint" className="muted">{blocked ? 'PULL完了まで変更できません。' : paid === 0 ? '返還対象の支払済みRSはありません。' : `支払済み ${n(paid)} RSを全額返還。確認後に実行します。`}</p></div>
    {confirming && <RespecDialog state={state} controller={controller} onClose={close} />}
  </section>
}
