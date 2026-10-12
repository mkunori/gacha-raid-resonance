# ゲームコア

このディレクトリにUI・ストレージ非依存の純粋関数を追加する。
通常独立抽選・H1と基本戦闘・3共鳴・単一PULLエンジンを実装済み。
UI・保存への接続はなく、未実装関数のダミーや空モジュールは置かない。

| モジュール | 責務 |
| --- | --- |
| gacha.ts（実装済み） | drawNormalPullで独立抽選、applyNormalPullStacksでH1加算。新しい値を返し、入力を変更しない。ダメージ・追加効果を適用しない |
| resonance.ts（実装済み） | findNextResonance / resolveResonances：優先順位・3+3消費・FLAME/THUNDER予約・OVERLOAD・複数共鳴 |
| combat.ts（実装済み） | calculateAttack / calculateNormalDamage / calculateResonanceDamage：基礎A・通常/共鳴ダメージ。SPECIAL/JACKPOTは後続 |
| boss.ts（実装済み） | calculateBossMaxHp / calculateBossReward / applyBossDamage / finishBossDefeat：通常HP/報酬・PULL終了後の遷移。特殊補正は後続 |
| engine.ts（実装済み） | createInitialGameState / executeNormalPull：単一PULLの状態・イベント確定。H2/追加効果/一括キュー/SPECIALは後続 |
| validation.ts（実装済み） | コア数値・スタック・一時効果の共通検証。保存JSONのスキーマ検証は担当しない |
| upgrades.ts（未実装） | 手動購入、価格、支払済みRS、RESPEC |

詳細: [技術設計](../../docs/TECHNICAL_DESIGN.md)。
