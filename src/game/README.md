# ゲームコア

このディレクトリにUI・ストレージ非依存の純粋関数を追加する。
通常独立抽選・H1/H2と基本戦闘・3共鳴・追加効果・単一/一括PULLエンジンを実装済み。
UI・保存への接続はなく、未実装関数のダミーや空モジュールは置かない。

| モジュール | 責務 |
| --- | --- |
| gacha.ts（実装済み） | drawNormalPullで独立抽選、applyNormalPullStacksでH1加算。新しい値を返し、入力を変更しない。ダメージ・追加効果を適用しない |
| resonance.ts（実装済み） | findNextResonance / resolveResonances：優先順位・3+3消費・FLAME/THUNDER予約・OVERLOAD・H2/BOOST乗算・複数共鳴 |
| combat.ts（実装済み） | calculateAttack / calculateNormalDamage / calculateResonanceDamage：基礎A・通常/共鳴ダメージ。SPECIAL/JACKPOTは後続 |
| boss.ts（実装済み） | calculateBossMaxHp / calculateBossReward / applyBossDamage / finishBossDefeat：通常HP/報酬・PULL終了後の遷移。特殊補正は後続 |
| engine.ts（実装済み） | createInitialGameState / executeNormalPull：実PULL単位の状態・イベント確定。executeNormalPulls / resumePendingNormalPulls：CHAIN付き一括処理・上限・集計・再開。SPECIAL/JACKPOTは後続 |
| validation.ts（実装済み） | コア数値・スタック・一時効果の共通検証。保存JSONのスキーマ検証は担当しない |
| upgrades.ts（未実装） | 手動購入、価格、支払済みRS、RESPEC |

詳細: [技術設計](../../docs/TECHNICAL_DESIGN.md)。

`executeNormalPulls(state, count, rng, limit?)`は新規操作で、残キューがあれば拒否する。
`resumePendingNormalPulls(state, rng, limit?)`は残キューのみ処理する。
`executeNormalPull`は実PULLを1回だけ進める低レベルAPI。キューがあればCHAIN優先で先頭を消費し、
空なら基本PULLを1回実行する。生成したCHAINはキューに残すため、×1操作全体にはexecuteNormalPullsを使う。
入出力は不変スナップショットとして扱う。空キュー再開は入力参照をそのまま返す。
例外時に入力は変わらないがRNGは巻き戻さない。再開時は同じRNGの続きが必要。
