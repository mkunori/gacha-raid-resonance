# GACHA RAID: RESONANCE

無料・無制限のガチャがボスへの攻撃になる、ソロ向けブラウザゲームです。
炎・風・雷の共鳴と、ボス撃破で獲得するRESONANCE SHARD（RS）による強化を組み合わせるゲームです。

## 開発状況と主な予定機能

Phase 7-Aの基本戦闘画面を実装済みです。ボスHP・特性・Stage・属性・一時効果・RS・ゲージを表示し、
NORMAL ×1/10/100/1000とSPECIAL ×1/MAXを解放条件に応じて操作できます。
大量PULLは100実PULLごとに描画を挟み、結果を集計します。失敗時は最後の確定状態を保持し、保留分を再開できます。
長期CHAINや大量SPECIALは累積10,000実PULLで一時停止し、残りを破棄せず手動で再開できます。再開にも同じ上限を適用します。
Phase 8-Bとして、このブラウザのlocalStorageへの自動保存・起動時復元に対応しています。
Phase 8-Aとして、全GameState・表示設定・RNG状態を含むSaveDataV1の検証/JSON変換と、保存可能な決定的RNGを実装済みです。
成功したチャンクのGameStateとRNGを一緒に保存し、保留NORMAL/CHAIN/SPECIALは再読込後に手動再開できます。
破損・未来版・読込不能・別タブの変更時は元データを保護して保存を停止し、理由を表示します。
UI非依存の通常ガチャ独立抽選・H1、基本ダメージ、3共鳴、単一PULL戦闘エンジン、
ボスHP・撃破RS・次Stage進行を実装済みです。FLAME/THUNDERの予約効果とOVERLOADのゲージ獲得に対応します。
H2触媒、CHAIN/CHARGE/BOOST、×1/10/100/1000の一括NORMAL PULLと中断・再開も実装済みです。
手動SPECIAL（単発/開始時回数固定の×MAXと再開）、Stage 20以降のJACKPOTもコアに実装済みです。
Stage 1〜50の戦闘ルールとして、10種の特殊ボス補正、Stage別解放、フォーカス切替、Stage 50クリア判定もコアに実装済みです。
Stage 50撃破時に一度だけクリアを通知し、残りPULLを保持してStage 51以降の通常ボスへ進めます。
RSによる3種の手動1Lv購入、価格・購入可否の取得、支払台帳と無料の全額返還RESPECもコアに実装済みです。
保留PULL中の購入・RESPECは拒否し、戦闘と再開の等価性を保ちます。
Stage 50クリア済み状態を簡易表示します。Phase 7-Bとして3強化の情報/手動1Lv購入、無料RESPEC確認と全返還、Stage 6以降の4Focus切替を画面に接続済みです。
busy・保留PULL中は育成操作を拒否し、成功/失敗を通知します。集計ハイライト・累積統計・演出軽減/スキップは実装済みです。Phase 8-CとしてJSON Export/Import・確認付き削除・保存停止状態からの明示的復旧に対応しています。
PC・スマートフォン対応の静的Webアプリです。サーバー・認証は使用しません。

## 採用技術

TypeScript / React / Vite / CSS / Vitest / ESLint / GitHub Actions / GitHub Pages。
Node.js 24（[.node-version](.node-version)）とnpmを使用します。

## ローカル開発

```sh
git clone https://github.com/mkunori/gacha-raid-resonance.git
cd gacha-raid-resonance
npm install
npm run dev
```

表示されたURLの /gacha-raid-resonance/ を開きます
（通常 http://localhost:5173/gacha-raid-resonance/）。
Windows PowerShellでnpm.ps1の実行が制限される場合はnpm.cmdを使用できます。

## テスト・ビルド

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

監視テストはnpm run test:watch。本番出力はdist/です。
CIとクリーンインストールではpackage-lock.jsonに基づくnpm ciを使用します。
Vitestは確率データ、全抽選境界、独立抽選・乱数消費順と回数、
固定列/固定シード再現、H1加算・上限・入力非破壊・不正値拒否に加え、
ダメージ式、共鳴順・バフ寿命、触媒/BOOSTの乗算、ゲージ、討伐遷移、
CHAIN再連鎖、一括/単発一致、100,000実PULL上限、中断・再開、数値オーバーフローを検証します。
SPECIAL独立抽選の境界・火力・予約回数・キュー排他と、JACKPOTのStage境界・SSR閾値・区間/集計も検証します。
全10特殊ボスのチャネル別補正・複合乗算、解放境界と未解放拒否、Focus切替、Stage50クリア・予約持ち越し・51以降の継続も検証します。
強化の価格境界・購入/返還台帳・二重返金防止・操作排他・数値安全性と、購入/RESPEC後の戦闘火力も検証します。
基本戦闘UIの解放表示・操作・状態同期、StrictMode・連打排他、チャンク集計・失敗再開・破棄時キャンセルも検証します。
PC・スマホ幅のブラウザ確認結果と再現手順は[画面確認記録](docs/UI_VERIFICATION.md)を参照してください。

## GitHub Pages

公開先URL: [GACHA RAID: RESONANCE](https://mkunori.github.io/gacha-raid-resonance/)。
デプロイWorkflowを整備済みです。実際の公開成否はGitHub Actionsの「Deploy GitHub Pages」で確認してください。
Vite baseは /gacha-raid-resonance/ です。
リポジトリSettings → Pages → SourceをGitHub Actionsに設定してください。
mainへのpushで検証後にdistをデプロイし、mainでの手動実行にも対応します。
作業ブランチからはデプロイしません。

## 仕様と開発方針

- [Issue #1：仕様作成履歴（CLOSED）](https://github.com/mkunori/gacha-raid-resonance/issues/1)
- [ゲーム仕様書（原文全文・確認事項）](docs/GAME_SPEC.md)
- [技術設計](docs/TECHNICAL_DESIGN.md)
- [実装計画・子タスク案](docs/IMPLEMENTATION_PLAN.md)

仕様の正本はdocs/GAME_SPEC.mdです。Issue #1は仕様作成履歴として参照し、実装は個別Issueで追跡します。
仕様・実装・テストの整合性を各PRで保ちます。
数値や計算式は独断で変更せず、仮定や確認事項を明示します。
Phase 7-CとしてSSR・共鳴・CHAIN・JACKPOT・SPECIAL・初回クリアの集計ハイライトと累積統計を接続済みです。
演出は操作完了・一時停止・エラー停止の確定分をまとめて表示し、再開時に過去の結果を再通知しません。
演出軽減・スキップとOSの動きを減らす設定に対応します。演出軽減は保存し、現在の演出のスキップは保存しません。
Phase 7-Dとして280〜1280pxの6幅・タッチエミュレーション・文字拡大・高負荷/再開・100連続操作を検証済みです。
文字の折返し、演出軽減のタップ領域、ページ末尾からPULLへ戻る導線を改善しました。
実機Android/iOS・長時間実プレイは未検証です。条件と参考性能値は[画面検証記録](docs/UI_VERIFICATION.md)を参照してください。
Phase 8-Bの自動保存・表示設定の永続化・RNG/予約復元は実装済みです。復元時に過去のハイライト・クリア演出を新規通知しません。
通常は更新後500msで保存し、連続更新中も最大2秒間隔、非表示/離脱時にも確定状態の保存を試みます。
容量不足等では保存失敗を表示し、以降の更新/離脱で再試行します。別タブ競合時は再読込が必要です。同時書込の完全な排他・自動マージは保証しません。
セーブデータ管理から最新確定状態をExportできます。破損・未来版の保存元データは、未検証バックアップとして別名で取得できます。
Importは最大128 KiBのファイルを完全検証し、進行・RS・強化・保留予約・設定のプレビューを確認してから適用します。
Import・削除はPULL処理中はできません。保留予約がある場合も確認して置換できます。取消では変更しません。
確定時に旧自動保存を停止し、保存操作が成功してからページを再読込します。確認中に進行・設定・保存データが変わった場合は再確認が必要です。
削除はこのゲームのキーだけが対象で、事前Exportを推奨します。Exportしたファイルはゲーム状態を含み、暗号化されていません。
次はPhase 9の公開版検証です。バランス調整には未着手です。
Phase 7-A〜7-Dは完了しました。Phase 8の詳細な引き継ぎ項目は[実装計画](docs/IMPLEMENTATION_PLAN.md)に記録しています。
Phase 8-Aの[保存API](src/storage/README.md)はブラウザ非依存です。未知キー・不正値・不正台帳・未来版を自動修復せず拒否し、JSON往復と同一RNG状態からの両保留キュー継続をテストします。
