# 技術設計（初期基盤）

基準: [GAME_SPEC v0.6](GAME_SPEC.md)、[親Issue #1](https://github.com/mkunori/gacha-raid-resonance/issues/1)。
本書の将来設計は実装済み機能ではない。ゲームの数値・解放順・1PULL順序はGAME_SPECを正とする。

## 構成

```text
.github/workflows/       CIとmain専用Pagesデプロイ
docs/                   仕様、設計、段階的な計画
src/
  components/           表示と操作のコンポーネント
  data/rules.ts         v0.6確率・倍率・コスト・解放設定（初期定義）
  game/                 今回は責務READMEのみ。コアは後続PRで追加
    gacha.ts            抽選
    resonance.ts        共鳴
    combat.ts           ダメージ
    boss.ts             ボス・Stage進行
    upgrades.ts         購入・RESPEC
    engine.ts           逐次処理と状態確定
  storage/              今回は責務READMEのみ。保存アダプターは後続
  types/game.ts         UI非依存の型契約案
  App.tsx               画面の構成
  main.tsx              React起動
  styles.css            レスポンシブな表示
```

不要な空モジュール・ゲームエンジン・状態管理ライブラリは追加しない。
特殊ボス表・共鳴ペア優先順位など、今回未定義の設定は各機能の実装PRでsrc/dataに追加し、GAME_SPECとの照合テストを行う。

## Reactの責務と状態の境界

現在はAppとDevelopmentNoticeでタイトル・開発中案内を表示する。
将来はBattlePanel（ボスHP・残留属性・耐性）、PullControls（解放条件・操作）、
UpgradePanel（価格・購入・確認）、StatisticsPanel、SettingsPanelに分割する。
Reactは表示・入力・確認ダイアログ・結果集計のみを担当し、抽選式を持たない。

まずReact標準の状態管理で十分。アクション実行の境界でコアを呼び、
操作完了時または安全な分割境界で新しいGameStateをまとめて反映する。
RNGはイベントハンドラーでコアに渡し、再描画中やReactの再実行可能な更新関数内で乱数を消費しない。
大量抽選はチャンクで実行し、実行中の競合操作をガードする。1件ずつDOM更新しない。
Web Workerは実測で必要になった場合のみ検討する。

## GameState案

型の詳細は[src/types/game.ts](../src/types/game.ts)。
Stage・最高Stage・現在HP・3属性スタック、GAUGE、RS、強化Lv、支払済みRS、
CATALYST、フォーカス、一時効果、JACKPOT区間、未実行通常PULL数、統計を保持する。
統計は通常/SPECIAL回数、SSR、共鳴種類別回数、ボス撃破、JACKPOTを含む。
表示設定はGameStateと分離してSaveDataV1に格納する。
ボス最大HP・基礎攻撃力・価格・解放状態はStage/強化Lv/設定から導出し、
保存した重複値を正としない。解放条件のStage 5撃破はStage 6到達で復元する。

```ts
// 将来のコアAPI案（今回未実装）
type EngineResult = { state: GameState; events: GameEvent[] }
function execute(state: GameState, action: GameAction, rng: RandomSource): EngineResult
```

GameActionは通常抽選、SPECIAL、強化、振り直し、フォーカス切替。
GameEventは抽選結果、チャネル別ダメージ、共鳴、討伐、報酬、解放等の判別共用体を想定。
入力を破壊せず新状態を返す。時計・localStorage・React・ネットワークを参照しない。
具体的なイベントとアクションの型は利用するPRで追加する。

## 抽選とダメージの分離

gachaはRNGから属性・レアリティ・追加効果をそれぞれ独立に抽選し、NormalPullResultを返す。
SPECIALの結果も独立した抽選関数とする。抽選関数はHPを変更しない。
combatは確定結果とA・一時効果・ボス補正からダメージを計算し、乱数を使わない。
チャネルは通常／共鳴／SPECIAL／JACKPOTを明示し、JACKPOTに通常耐性を誤適用しない。
HP/RS/価格は仕様のceilのみ、ダメージは途中丸めせず、表示のみ丸める。

engineはGAME_SPEC第7章の8ステップを唯一の通常PULL経路として反復する。
SSRのCATALYSTは共鳴前、BOOST取得は共鳴後、討伐遷移はJACKPOT処理後。
余剰ダメージは捨て、未実行PULLは次Stageへ。共鳴ループにはガードを持つ。
BOOST/THUNDER/FLAME/属性スタックを討伐で初期化し、CATALYST/GAUGE/JACKPOT区間は保持する。

CHAINの安全上限100,000では未実行の個数をpendingNormalPullsに残し、
1PULL終了ごとの一貫した状態を確定する設計案。通常の分割実行では同じRNGストリームを維持する。
中断・再読込時の再開操作は実装PRで確認して決定し、黙って破棄しない。
保存するRNG状態や再開後の抽選再現範囲は未確定。ゲームの公開乱数に暗号学的保証は要求しない。

## 乱数とテスト

RandomSourceは[0,1)を返す注入関数。通常利用は境界でMath.randomを渡す。
テストでは固定列（境界値・特定順序）と固定シードPRNGをテスト用ヘルパーで用意する。
テスト用PRNGのアルゴリズムと種を固定し、失敗時に種を表示する。
確率閾値の直前/一致/直後、合計100%、独立抽選の消費順を検証する。
同じ固定乱数列で×1反復と×10/100/1000の最終状態・イベント集計を比較する。
確率分布の統計テストを使う場合は固定種・許容範囲を明示し、ランダムなCI失敗を避ける。
シミュレーションの中央値は手動SPECIALの絶対期待値にしない。

## セーブ・ロード（未実装）

saveVersion: 1を持つJSONをlocalStorageに保存。キー案はgacha-raid-resonance:save。
ブラウザAPIはstorageに閉じ込め、シリアライズ・検証・移行は純粋関数にする。
JSON.parseの結果はunknownとして受け取り、型アサーションだけで信用しない。
Stage整数、有限HP、スタック0〜12、CATALYST/BOOST0〜3、非負整数RS・Lv・カウンター、
JACKPOT区間0〜99、既知の属性/フォーカス、設定、未消化キューの整合性を検証する。
実装時にStage 50以降、GAUGE上限、数値の安全整数境界を仕様確認して反映する。
将来versionは上書きせずエラーを表示し、既知の旧versionのみ明示的に移行する。
破損時は読み込み失敗を通知し、初期化できる操作を提供する。破損データを無言で上書きしない。

状態更新後にデバウンス保存し、pagehide/visibilitychangeで確定状態をflushする。
離脱イベントだけに依存せず、巨大操作も安全なチャンク境界でチェックポイント保存する。
ストレージ容量超過や利用拒否は捕捉し、保存失敗をUIに表示する。
Exportは確定した版付きJSON、Importはパース・完全検証後に確認して置換する。
削除とRESPECも確認を必要とし、RESPECは支払済みRSを返却して台帳をゼロにする。
今回は保存機能も初期GameState生成も未実装。

## CIとGitHub Pages

Node.js 24、npmロックファイルを利用。CIはmainへのPRとmain pushで
npm ci → typecheck → lint → test → build。
Pages Workflowもデプロイ前に同じチェックを実行し、失敗したビルドを公開しない。
リポジトリSettings → Pages → Build and deploymentのSourceをGitHub Actionsに設定する。
初回のgithub-pages環境作成・保護設定やActions利用権限はリポジトリ管理側で確認する。
mainへのpushまたはmainを指定したworkflow_dispatchでdistをPagesに公開する。
作業ブランチからのデプロイはガードする。今回PRはマージしないため公開はまだ行わない。

Vite baseは/gacha-raid-resonance/。
公開予定URL: https://mkunori.github.io/gacha-raid-resonance/
ルーターは導入せず単一エントリーとし、このURLでのリロードを想定する。
後続のPages実公開フェーズでスマホ/PCとリロードを確認する。

## 将来の非同期協力

入力状態・アクション・RNG→状態・イベントという境界を維持すれば、
ゲームコアと設定をサーバー側でも利用できる。将来は抽選・報酬確定をサーバーで行い、
UIはアクション送信と返却イベント表示を担当する。
通信アダプターとローカル保存を差し替え可能にするが、現在は通信・認証・DB・同期を作らない。
サーバー権威、冪等な操作ID、不正対策、共有ボスへの競合処理は協力プレイ着手時の別設計とする。
