# ゲームコア（次のPR以降）

このディレクトリにUI・ストレージ非依存の純粋関数を追加する。
現在はゲーム処理未実装。未実装関数のダミーや空モジュールは置かない。

| モジュール | 責務 |
| --- | --- |
| gacha.ts | 注入したRNGと設定から独立抽選。ダメージ・状態更新をしない |
| resonance.ts | 優先順位・3+3消費・予約効果・複数共鳴 |
| combat.ts | 通常・共鳴・SPECIAL・JACKPOTのチャネル別ダメージ |
| boss.ts | HP/報酬、補正、Stage進行、持ち越し・リセット |
| upgrades.ts | 手動購入、価格、支払済みRS、RESPEC |
| engine.ts | 1PULL順序、CHAINキュー、SPECIAL、状態・イベントの確定 |

詳細: [技術設計](../../docs/TECHNICAL_DESIGN.md)。
