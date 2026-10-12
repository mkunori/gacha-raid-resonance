# ゲームコア

このディレクトリにUI・ストレージ非依存の純粋関数を追加する。
gacha.tsの通常独立抽選とH1スタック加算を実装済み。
他モジュールは後続PRで追加する。未実装関数のダミーや空モジュールは置かない。

| モジュール | 責務 |
| --- | --- |
| gacha.ts（実装済み） | drawNormalPullで独立抽選、applyNormalPullStacksでH1加算。新しい値を返し、入力を変更しない。ダメージ・追加効果を適用しない |
| resonance.ts | 優先順位・3+3消費・予約効果・複数共鳴 |
| combat.ts | 通常・共鳴・SPECIAL・JACKPOTのチャネル別ダメージ |
| boss.ts | HP/報酬、補正、Stage進行、持ち越し・リセット |
| upgrades.ts | 手動購入、価格、支払済みRS、RESPEC |
| engine.ts | 1PULL順序、CHAINキュー、SPECIAL、状態・イベントの確定 |

詳細: [技術設計](../../docs/TECHNICAL_DESIGN.md)。
