# 技術設計

仕様の正本: [GAME_SPEC v0.6](GAME_SPEC.md)。[Issue #1](https://github.com/mkunori/gacha-raid-resonance/issues/1)はCLOSEDの仕様作成履歴。
本書の将来設計は実装済み機能ではない。ゲームの数値・解放順・1PULL順序はGAME_SPECを正とする。

## 構成

```text
.github/workflows/       CIとmain専用Pagesデプロイ
docs/                   仕様、設計、段階的な計画
src/
  components/           表示と操作のコンポーネント
  data/rules.ts         v0.6確率・倍率・コスト・解放設定（初期定義）
  game/                 通常抽選・H1・基本戦闘・単一PULL実装済み
    gacha.ts            独立抽選とH1スタック加算
    resonance.ts        3共鳴・予約効果・反復判定
    combat.ts           基礎A・通常/共鳴ダメージ
    boss.ts             通常ボス・PULL終了後のStage進行
    validation.ts       数値・スタック・一時効果の検証
    upgrades.ts         購入・RESPEC（未実装）
    engine.ts           初期状態・単一PULLの統合
  storage/              今回は責務READMEのみ。保存アダプターは後続
  types/game.ts         UI非依存の型契約案
  test/                 テスト専用の固定列・固定シードRNG
  App.tsx               画面の構成
  main.tsx              React起動
  styles.css            レスポンシブな表示
```

不要な空モジュール・ゲームエンジン・状態管理ライブラリは追加しない。
共鳴ペアとフォーカス優先・固定順はsrc/data/rules.tsに集約済み。
特殊ボス表など未定義の設定は各機能の実装PRでsrc/dataに追加し、GAME_SPECとの照合テストを行う。

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
Phase 2ではCombatEvent / CombatResultを実装済み。汎用GameActionは必要なアクション追加時に導入する。

## 抽選とダメージの分離

gachaはRNGから属性・レアリティ・追加効果をそれぞれ独立に抽選し、NormalPullResultを返す。
通常抽選・H1・基本戦闘・単一PULLは実装済み。SPECIAL・H2・追加効果・一括engineは後続PRの設計である。

### 通常ガチャの公開API（Issue #3）

- `drawNormalPull(focus: Focus, rng: RandomSource): NormalPullResult`
  はレアリティ → 属性 → 追加効果の順で各1回、計3回だけRNGを消費する。
  列挙順は明示した配列で固定し、確率は既存rules.tsを参照する。
  各区間は下端以上・上端未満。境界と一致した値は次区間に入る。
  v0.6の確率はすべて整数％なので、各確率を整数％へ変換して累積し、100で割った閾値と比較する。
  これにより0.92+0.02等の二進浮動小数点誤差で境界がずれることを防ぐ。
  将来、端数％を採用する場合は閾値の表現精度とテストを同じPRで更新する。
- RNGは有限なnumberかつ0以上1未満が必須。不正値はRangeErrorで即時停止し、再抽選しない。
  失敗までに消費した乱数は巻き戻さない。不正FocusはRangeError、RNG消費0回。
- `applyNormalPullStacks(stacks: Readonly<Record<Element, number>>, result: Readonly<Pick<NormalPullResult, 'element' | 'rarity'>>): Record<Element, number>`
  はH1を既存NORMAL_RARITIESから取得し、選ばれた属性だけを加算してCORE_RULES.stackCapで切り捨てる。
  全属性の入力は整数0〜12、属性/等級は既知値を要求し、違反はRangeError。
  常に新しいオブジェクトを返し、入力を変更しない。完全なNormalPullResultも渡せるが追加効果は参照しない。
- Stage解放ガード、共鳴消費、H2、CHAIN/CHARGE/BOOSTの発動、ダメージ、保存は担当しない。
  両APIはReact・ストレージ・Math.randomに依存しない。

### 戦闘計算と後続機能

SPECIALの結果も独立した抽選関数とする。抽選関数はHPを変更しない。
combatは確定結果とA・一時効果・ボス補正からダメージを計算し、乱数を使わない。
チャネルは通常／共鳴／SPECIAL／JACKPOTを明示し、JACKPOTに通常耐性を誤適用しない。
HP/RS/価格は仕様のceilのみ、ダメージは途中丸めせず、表示のみ丸める。

単一PULL engineは抽選→通常攻撃→H1→基本共鳴→基本ゲージ→追加効果未適用イベント→討伐確定の順で処理する。
後続でGAME_SPEC第7章の全8ステップを組み込む際、SSRのCATALYSTは共鳴前、BOOST取得は共鳴後、討伐遷移はJACKPOT処理後とする。
余剰ダメージは捨て、未実行PULLは次Stageへ。共鳴ループにはガードを持つ。
BOOST/THUNDER/FLAME/属性スタックを討伐で初期化し、CATALYST/GAUGE/JACKPOT区間は保持する。

### Phase 2の公開APIと状態契約（Issue #5）

| モジュール / API | 入力 → 出力 / 責務 |
| --- | --- |
| combat.calculateAttack | PULL POWER Lv → 基礎A |
| combat.calculateNormalDamage | A、rarity、FLAME有効フラグ、任意ボス倍率（既定1） → 通常ダメージ |
| combat.calculateResonanceDamage | A、RESONANCE POWER Lv、その他倍率、任意ボス倍率（既定1） → 共鳴ダメージ |
| boss.calculateBossMaxHp / calculateBossReward | 正整数Stage → ceilしたHP / RS |
| boss.applyBossDamage | 現HP、非負ダメージ → 丸めない残HP（PULL内は負値を許容） |
| boss.finishBossDefeat | 検証済みGameState → CombatResult。生存中は遷移なし、HP<=0なら1回だけ報酬/次Stage |
| resonance.findNextResonance | スタック、Focus → 次の共鳴またはnull |
| resonance.resolveResonances | スタック、一時状態、Focus、A、共鳴Lv → 新スタック/一時状態、ゲージ増分、発動順の共鳴/ダメージ |
| engine.createInitialGameState | 引数なし → 独立した初期GameState（Stage 1、強化Lv0、基本値はrulesを参照） |
| engine.executeNormalPull | GameState、RNG → CombatResult（新stateと順序付きCombatEvent[]） |

executeNormalPullは入力を検証後、既存drawNormalPullを呼び、正常時は乱数3回だけ消費する。
HP>0かつStage最大HP以下の確定状態を要求し、死亡途中状態の再入力による二重報酬を拒否する。
全てのPULL内ダメージは元のStageに属する。イベントのdamageは計算値で、残HPで切り詰めた値ではない。
討伐イベントとStage開始イベントは追加効果未適用イベントの後。次Stageは常に最大HPから開始する。
入力の各ネスト状態をコピーし、失敗時も呼出元の状態を変更しない。ただし消費済みRNGは巻き戻せない。
データ型そのもののJSONスキーマ検証は保存フェーズで扱い、このAPIはGameState型を前提に数値・列挙値のドメインを検証する。

FLAMEは今回共鳴×1.5と次の10通常PULL×1.15。通常攻撃で旧残回数を減らした後、共鳴で残回数10へ更新する。
THUNDERは既存予約を現在共鳴で使って消費してから、THUNDERであれば新しい予約を1つ残す。
同一PULL内の次共鳴にも効く。OVERLOADは1発ごとに+12。
反復上限はスタック総上限/(3+3)から導出し、ゼロダメージでもスタック消費により必ず終了する。
BOOSTやCATALYSTは有効な既存値を保持するが、取得・消費・ダメージ適用は行わない。
討伐時は属性とBOOST/THUNDER/FLAMEをリセットし、ゲージ・CATALYST・フォーカス・強化・支払台帳・キュー・JACKPOT区間は保持する。
更新する統計は通常PULL、SSR、種類別共鳴、討伐数と最高Stageのみ。他機能の統計は保持する。

Phase 2では全Stageが通常ボス倍率1.0。特殊ボスはPhase 5でチャネル別の倍率選択を接続する。
Stage 50撃破後は共通のStage+1を行い、終了状態を仮実装しない。最終仕様確定時の変更はboss.tsに局所化する。
ゲージはゲーム上の上限なし。資源/カウンター/Stage/Lvは安全整数、ダメージ・HPは有限で絶対値MAX_SAFE_INTEGER以下を要求する。
HPとダメージの小数は保持し、途中整数丸めをしない。数値演算が検証範囲を越えた場合はRangeErrorで結果全体を返さず停止する。
これはバランス上限ではなくJavaScript numberの数値安全境界であり、無限成長に対応する場合は数値表現を別途設計する。

### 後続の一括処理

CHAINの安全上限100,000では未実行の個数をpendingNormalPullsに残し、
1PULL終了ごとの一貫した状態を確定する設計案。通常の分割実行では同じRNGストリームを維持する。
中断・再読込時の再開操作は実装PRで確認して決定し、黙って破棄しない。
保存するRNG状態や再開後の抽選再現範囲は未確定。ゲームの公開乱数に暗号学的保証は要求しない。

## 乱数とテスト

RandomSourceは[0,1)を返す注入関数。通常利用は境界でMath.randomを渡す。
src/test/random.tsに固定列（枯渇時は例外）とMulberry32の固定シードRNGを実装済み。
固定シードは0x12345678（テスト名にも記載）。seed 1の既知出力でもアルゴリズムを固定する。
これらはテスト専用で本番の抽選APIには含めない。
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
初期GameState生成はengine.tsで実装済み。保存機能は未実装。

## CIとGitHub Pages

Node.js 24、npmロックファイルを利用。CIはmainへのPRとmain pushで
npm ci → typecheck → lint → test → build。
Pages Workflowもデプロイ前に同じチェックを実行し、失敗したビルドを公開しない。
リポジトリSettings → Pages → Build and deploymentのSourceをGitHub Actionsに設定する。
初回のgithub-pages環境作成・保護設定やActions利用権限はリポジトリ管理側で確認する。
mainへのpushまたはmainを指定したworkflow_dispatchでdistをPagesに公開する。
作業ブランチからのデプロイはガードする。Workflowの整備と実際の公開成功は区別し、
公開状態はGitHub ActionsのDeploy GitHub Pages実行結果と公開URLで確認する。

Vite baseは/gacha-raid-resonance/。
公開先URL: https://mkunori.github.io/gacha-raid-resonance/
ルーターは導入せず単一エントリーとし、このURLでのリロードを想定する。
初期基盤のマージ後に公開とアセット取得を確認し、ゲーム完成時にもスマホ/PCの操作とリロードを再確認する。

## 将来の非同期協力

入力状態・アクション・RNG→状態・イベントという境界を維持すれば、
ゲームコアと設定をサーバー側でも利用できる。将来は抽選・報酬確定をサーバーで行い、
UIはアクション送信と返却イベント表示を担当する。
通信アダプターとローカル保存を差し替え可能にするが、現在は通信・認証・DB・同期を作らない。
サーバー権威、冪等な操作ID、不正対策、共有ボスへの競合処理は協力プレイ着手時の別設計とする。
